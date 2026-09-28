import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import type { AuditService } from '../audit/audit.service';
import { HttpRequestConnector } from '../connectors/adapters/built-in/http-request.connector';
import { ContinueOnErrorHandler } from '../connectors/error-handlers/built-in/continue-on-error.handler';
import { RetryThenFallbackHandler } from '../connectors/error-handlers/built-in/retry-then-fallback.handler';
import { FallbackOnErrorHandler } from '../connectors/error-handlers/built-in/fallback-on-error.handler';
import type { ConnectorAdapterCollection } from '../connectors/ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { Workflow } from './domain/workflow';
import type { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowFileLoaderService, type WorkflowFile } from './workflow-file-loader.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import type { WorkflowScope } from './workflow-scope';
import type { WorkflowStatus } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

const BASE_WORKFLOW_PATH = resolve(__dirname, '../../../../workflows/fixtures/base.workflow.json');

/** Steps a spec writes by hand, as the `custom` steps a document has to declare them as. */
const asCustomSteps = (steps: Array<Record<string, unknown>>): Array<Record<string, unknown>> =>
  steps.map(({ name, ...config }) => ({ name, type: 'custom', config }));

const createWorkflowDefinition = (
  overrides: Record<string, unknown> = {},
): Record<string, unknown> => {
  const { agreements, ...base } = JSON.parse(readFileSync(BASE_WORKFLOW_PATH, 'utf8')) as Record<
    string,
    unknown
  >;

  // The fixture's agreement binds to a step of the fixture's own graph, so a spec replacing the
  // steps replaces what the declaration names — it goes with them unless the override brings it.
  return {
    ...base,
    ...(overrides.steps === undefined ? { agreements } : {}),
    ...overrides,
  };
};

const createWorkflowFile = (
  scope: WorkflowScope,
  overrides: Record<string, unknown> = {},
): WorkflowFile => {
  const definition = createWorkflowDefinition(overrides);

  return {
    scope,
    filePath: join('/workflows', scope, `${String(definition.id)}.workflow.json`),
    workflowId: definition.id as string,
    version: definition.version as number,
    name: definition.name as string | undefined,
    definition,
  };
};

/** The base fixture is a graph of `custom` steps, so its connectors sit on each step's config. */
const withUniformSourceKey = (
  definition: Record<string, unknown>,
  sourceKey: string,
): Record<string, unknown> => ({
  ...definition,
  steps: (definition.steps as Array<Record<string, unknown>>).map((step) => {
    const config = step.config as Record<string, unknown>;

    return {
      ...step,
      config: {
        ...config,
        connectors: ((config.connectors as Array<Record<string, unknown>>) ?? []).map(
          (connector) => ({ ...connector, config: { sourceKey } }),
        ),
      },
    };
  }),
});

const createWorkflowFileWithUniformSourceKey = (
  scope: WorkflowScope,
  sourceKey: string,
  overrides: Record<string, unknown> = {},
): WorkflowFile => {
  const definition = withUniformSourceKey(createWorkflowDefinition(overrides), sourceKey);

  return {
    scope,
    filePath: join('/workflows', scope, `${String(definition.id)}.workflow.json`),
    workflowId: definition.id as string,
    version: definition.version as number,
    definition,
  };
};

const createStoredWorkflow = (
  name: string,
  version: number,
  status: WorkflowStatus,
  scope: WorkflowScope = 'users',
  label: string | null = null,
): WorkflowVersionEntity =>
  ({
    workflowVersionId: `${name}@${version}`,
    workflowId: `wf-${name}`,
    workflow: { workflowId: `wf-${name}`, key: name, name: label },
    version,
    scope,
    status,
    definition: createWorkflowDefinition({ id: name, version }),
  }) as unknown as WorkflowVersionEntity;

/**
 * Stands in for the real two tables: `publishFromFiles` keys rows by `key@version` exactly like
 * `uq_workflow_versions_workflow_version` does once the key is resolved to its parent's id, and
 * leaves a stored revision alone the way the real publish does — seeding twice cannot duplicate
 * and never rewrites `status` or the definition. The family label follows the highest version
 * that declares one, as the real publish keeps it. Every read goes through it, so a test that mutates `rows` after
 * startup is asserting exactly what a UI edit against the live tables would do.
 */
class InMemoryWorkflowsRepository {
  readonly rows = new Map<string, WorkflowVersionEntity>();

  constructor(storedRows: readonly WorkflowVersionEntity[] = []) {
    for (const row of storedRows) {
      this.rows.set(this.keyOf(row.workflow.key, row.version), row);
    }
  }

  publishFromFiles = jest.fn(async (_manager: unknown, files: readonly WorkflowFile[]) => {
    for (const file of [...files].sort((left, right) => left.version - right.version)) {
      const revisionKey = this.keyOf(file.workflowId, file.version);

      if (this.rows.has(revisionKey)) {
        continue;
      }

      const family = [...this.rows.values()].find((row) => row.workflow.key === file.workflowId);
      const workflowId = family?.workflowId ?? `wf-${file.workflowId}`;
      const workflow = family?.workflow ?? { workflowId, key: file.workflowId, name: null };

      if (file.name !== undefined) {
        workflow.name = file.name;
      }

      this.rows.set(revisionKey, {
        workflowVersionId: revisionKey,
        workflowId,
        workflow,
        version: file.version,
        scope: file.scope,
        status: 'published',
        definition: file.definition,
      } as unknown as WorkflowVersionEntity);
    }
  });

  findAll = jest.fn(async (_manager: unknown, scopes: readonly WorkflowScope[]) =>
    this.inScope(scopes),
  );

  findRevision = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], name: string, version: number) =>
      this.inScope(scopes).find((row) => row.workflow.key === name && row.version === version) ??
      null,
  );

  findLatestPublished = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], name: string) =>
      this.inScope(scopes)
        .filter((row) => row.workflow.key === name && row.status === 'published')
        .sort((left, right) => right.version - left.version)[0] ?? null,
  );

  countRevisions = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], name: string) =>
      this.inScope(scopes).filter((row) => row.workflow.key === name).length,
  );

  countPublished = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[]) =>
      this.inScope(scopes).filter((row) => row.status === 'published').length,
  );

  findVersionById = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], workflowVersionId: string) =>
      this.inScope(scopes).find((row) => row.workflowVersionId === workflowVersionId) ?? null,
  );

  private keyOf(name: string, version: number): string {
    return `${name}@${version}`;
  }

  private inScope(scopes: readonly WorkflowScope[]): WorkflowVersionEntity[] {
    return [...this.rows.values()].filter((row) => scopes.includes(row.scope));
  }
}

describe('WorkflowRegistryService', () => {
  let repository: InMemoryWorkflowsRepository;
  let service: WorkflowRegistryService;

  const createRegistry = async (options: {
    files: WorkflowFile[];
    nodeEnv?: string;
    connectorExecutionPort?: ConnectorExecutionPort;
    repository?: InMemoryWorkflowsRepository;
  }): Promise<WorkflowRegistryService> => {
    const workflowsRepository = options.repository ?? repository;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        { provide: DataSource, useValue: { manager: {} } },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(options.nodeEnv ?? 'test') },
        },
        {
          provide: WorkflowFileLoaderService,
          useValue: {
            load: jest.fn((scopes: readonly WorkflowScope[]) =>
              options.files.filter((file) => scopes.includes(file.scope)),
            ),
          },
        },
        { provide: WorkflowsRepository, useValue: workflowsRepository },
        ...(options.connectorExecutionPort
          ? [
              {
                provide: WORKFLOW_CONNECTOR_EXECUTION_PORT,
                useValue: options.connectorExecutionPort,
              },
            ]
          : []),
      ],
    }).compile();

    await module.init();

    return module.get(WorkflowRegistryService);
  };

  beforeEach(async () => {
    repository = new InMemoryWorkflowsRepository();
    service = await createRegistry({ files: [createWorkflowFile('fixtures')] });
  });

  it('returns a workflow domain instance for its pinned version', async () => {
    const workflow = await service.getById('base', 1);

    expect(workflow).toBeInstanceOf(Workflow);
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
      scores: {},
    });
  });

  it('publishes discovered files into the database before serving them', () => {
    expect(repository.publishFromFiles).toHaveBeenCalledTimes(1);
    expect(repository.publishFromFiles.mock.calls[0][1]).toEqual([
      expect.objectContaining({ workflowId: 'base', version: 1, scope: 'fixtures' }),
    ]);
  });

  it('reads the database on every lookup instead of a snapshot taken at startup', async () => {
    repository.findLatestPublished.mockClear();

    await service.getById('base');
    await service.getById('base');

    expect(repository.findLatestPublished).toHaveBeenCalledTimes(2);
  });

  it('serves a revision added to the database after startup without restarting', async () => {
    repository.rows.set('added-later@1', createStoredWorkflow('added-later', 1, 'published'));

    expect(await service.getById('added-later')).toBeInstanceOf(Workflow);
  });

  it('stops serving a revision drafted in the database after startup', async () => {
    repository.rows.get('base@1')!.status = 'draft';

    await expect(service.getById('base')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('reads inside the transaction the caller passes', async () => {
    const manager = {} as never;

    await service.getById('base', 1, manager);

    expect(repository.findRevision).toHaveBeenLastCalledWith(manager, expect.anything(), 'base', 1);
  });

  describe('resolveForStart', () => {
    it('resolves the highest published revision and its own version id when unpinned', async () => {
      const resolved = await service.resolveForStart('base');

      expect(resolved.workflow).toBeInstanceOf(Workflow);
      expect(resolved.versionId).toBe(repository.rows.get('base@1')!.workflowVersionId);
    });

    it('resolves a pinned revision and its own version id', async () => {
      const registry = await createRegistry({
        files: [
          createWorkflowFile('users', { id: 'versioned', version: 1 }),
          createWorkflowFile('users', { id: 'versioned', version: 2 }),
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      const resolved = await registry.resolveForStart('versioned', 1);

      expect(resolved.workflow).toBeInstanceOf(Workflow);
      expect(resolved.versionId).toBe('versioned@1');
    });

    it('refuses to start a retired revision even when pinned', async () => {
      const registry = await createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([
          createStoredWorkflow('discontinued', 1, 'retired'),
        ]),
      });

      await expect(registry.resolveForStart('discontinued', 1)).rejects.toThrow(
        WorkflowRetiredException,
      );
    });

    it('reports an unknown workflow the same way getById does', async () => {
      await expect(service.resolveForStart('unknown')).rejects.toThrow(WorkflowNotFoundException);
    });
  });

  describe('getByVersionId', () => {
    it('returns the workflow stored under a version uuid', async () => {
      const versionId = repository.rows.get('base@1')!.workflowVersionId;

      const workflow = await service.getByVersionId(versionId);

      expect(workflow).toBeInstanceOf(Workflow);
    });

    it('refuses a version that was retired after the onboarding it belongs to started', async () => {
      const versionId = repository.rows.get('base@1')!.workflowVersionId;
      repository.rows.get('base@1')!.status = 'retired';

      await expect(service.getByVersionId(versionId)).rejects.toThrow(WorkflowRetiredException);
    });

    it('reports not found for an unknown version id', async () => {
      await expect(service.getByVersionId('unknown-version-id')).rejects.toThrow(
        WorkflowNotFoundException,
      );
    });

    it('reads inside the transaction the caller passes', async () => {
      const manager = {} as never;
      const versionId = repository.rows.get('base@1')!.workflowVersionId;
      repository.findVersionById.mockClear();

      await service.getByVersionId(versionId, manager);

      expect(repository.findVersionById).toHaveBeenLastCalledWith(
        manager,
        expect.anything(),
        versionId,
      );
    });
  });

  it('serves workflows that exist only in the database and never on disk', async () => {
    const storedOnlyRepository = new InMemoryWorkflowsRepository([
      createStoredWorkflow('stored-only', 3, 'published'),
    ]);

    const registry = await createRegistry({ files: [], repository: storedOnlyRepository });

    expect(await registry.getById('stored-only', 3)).toBeInstanceOf(Workflow);
  });

  it('does not duplicate rows when startup seeding runs again', async () => {
    await createRegistry({ files: [createWorkflowFile('fixtures')] });

    expect([...repository.rows.keys()]).toEqual(['base@1']);
  });

  it('loads fixture workflows outside production', async () => {
    const registry = await createRegistry({
      files: [createWorkflowFile('fixtures')],
      nodeEnv: 'development',
    });

    expect(await registry.getById('base')).toBeInstanceOf(Workflow);
  });

  it('neither stores nor serves fixture workflows on production', async () => {
    const productionRepository = new InMemoryWorkflowsRepository();
    const registry = await createRegistry({
      files: [createWorkflowFile('fixtures'), createWorkflowFile('users', { id: 'custom' })],
      nodeEnv: 'production',
      repository: productionRepository,
    });

    expect([...productionRepository.rows.keys()]).toEqual(['custom@1']);
    expect(await registry.getById('custom')).toBeInstanceOf(Workflow);
    await expect(registry.getById('base')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('hides fixture rows already stored in the database on production', async () => {
    const productionRepository = new InMemoryWorkflowsRepository([
      createStoredWorkflow('base', 1, 'published', 'fixtures'),
    ]);

    const registry = await createRegistry({
      files: [],
      nodeEnv: 'production',
      repository: productionRepository,
    });

    await expect(registry.getById('base')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('resolves the highest published version when no version is pinned', async () => {
    const registry = await createRegistry({
      files: [
        createWorkflowFile('users', { id: 'versioned', version: 2 }),
        createWorkflowFile('users', { id: 'versioned', version: 10 }),
        createWorkflowFile('users', { id: 'versioned', version: 3 }),
      ],
      repository: new InMemoryWorkflowsRepository(),
    });

    expect((await registry.getById('versioned')).version).toBe(10);
    expect((await registry.getById('versioned', 2)).version).toBe(2);
    expect((await registry.getById('versioned', 3)).version).toBe(3);
  });

  it('keeps serving the published version while a newer revision is still a draft', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([
        createStoredWorkflow('versioned', 1, 'published'),
        createStoredWorkflow('versioned', 2, 'published'),
        createStoredWorkflow('versioned', 3, 'draft'),
      ]),
    });

    expect((await registry.getById('versioned')).version).toBe(2);
    expect((await registry.getById('versioned', 3)).version).toBe(3);
  });

  it('refuses to serve a workflow whose every revision is still a draft', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([createStoredWorkflow('drafted', 1, 'draft')]),
    });

    await expect(registry.getById('drafted')).rejects.toThrow(WorkflowNotFoundException);
    expect(await registry.getById('drafted', 1)).toBeInstanceOf(Workflow);
  });

  it('leaves a revision that was moved to draft in the database a draft on the next startup', async () => {
    const draftedRepository = new InMemoryWorkflowsRepository([
      createStoredWorkflow('base', 1, 'draft', 'fixtures'),
    ]);

    const registry = await createRegistry({
      files: [createWorkflowFile('fixtures')],
      repository: draftedRepository,
    });

    expect(draftedRepository.rows.get('base@1')?.status).toBe('draft');
    await expect(registry.getById('base')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('leaves a revision that was retired in the database retired on the next startup', async () => {
    const retiredRepository = new InMemoryWorkflowsRepository([
      createStoredWorkflow('base', 1, 'retired', 'fixtures'),
    ]);

    await createRegistry({
      files: [createWorkflowFile('fixtures')],
      repository: retiredRepository,
    });

    expect(retiredRepository.rows.get('base@1')?.status).toBe('retired');
  });

  it('refuses a retired revision even when a caller pins it explicitly', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([
        createStoredWorkflow('discontinued', 1, 'retired'),
      ]),
    });

    await expect(registry.getById('discontinued', 1)).rejects.toThrow(WorkflowRetiredException);
    await expect(registry.getById('discontinued', 1)).rejects.toThrow('WORKFLOW_RETIRED');
  });

  it('refuses a retired revision that used to be the published one', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([
        createStoredWorkflow('discontinued', 1, 'retired'),
        createStoredWorkflow('discontinued', 2, 'published'),
      ]),
    });

    expect((await registry.getById('discontinued')).version).toBe(2);
    await expect(registry.getById('discontinued', 1)).rejects.toThrow(WorkflowRetiredException);
  });

  it('reports a workflow whose every revision is retired as not found when unpinned', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([
        createStoredWorkflow('discontinued', 1, 'retired'),
      ]),
    });

    await expect(registry.getById('discontinued')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('returns stable not-found for an unknown workflow id', async () => {
    await expect(service.getById('unknown')).rejects.toThrow(NotFoundException);
    await expect(service.getById('unknown')).rejects.toThrow(WorkflowNotFoundException);
    await expect(service.getById('unknown')).rejects.toThrow('WORKFLOW_NOT_FOUND');
  });

  it('returns stable not-found for an unknown workflow id pinned to a version', async () => {
    await expect(service.getById('unknown', 1)).rejects.toThrow(WorkflowNotFoundException);
  });

  it('rejects a workflow version mismatch with the stable configuration error', async () => {
    await expect(service.getById('base', 2)).rejects.toThrow(WorkflowInvalidError);
    await expect(service.getById('base', 2)).rejects.toThrow('WORKFLOW_INVALID');
  });

  it('names the missing revision so a caller can tell it apart from a malformed definition', async () => {
    await expect(service.getById('base', 2)).rejects.toThrow(WorkflowRevisionNotFoundError);
    await expect(service.getById('base', 2)).rejects.toMatchObject({
      workflowId: 'base',
      version: 2,
    });
  });

  it('warns instead of failing when no workflow is available at all', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository(),
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('No published workflows are available'),
    );
    await expect(registry.getById('base')).rejects.toThrow(WorkflowNotFoundException);
  });

  it('warns when every stored revision is retired or drafted', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([
        createStoredWorkflow('discontinued', 1, 'retired'),
        createStoredWorkflow('unfinished', 1, 'draft'),
      ]),
    });

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('No published workflows are available'),
    );
  });

  it('passes the injected connector execution port to created workflows', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      resume: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    } as ConnectorExecutionPort;

    const registry = await createRegistry({
      files: [createWorkflowFile('fixtures')],
      connectorExecutionPort,
      repository: new InMemoryWorkflowsRepository(),
    });
    const workflow = await registry.getById('base', 1);

    expect(
      (workflow as unknown as { connectorExecutionPort?: ConnectorExecutionPort })
        .connectorExecutionPort,
    ).toBe(connectorExecutionPort);
  });

  it('validates every step connector declaration while building the registry', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      resume: jest.fn(),
      validateDeclarations: jest.fn(),
    } as ConnectorExecutionPort;

    await createRegistry({
      files: [createWorkflowFile('fixtures')],
      connectorExecutionPort,
      repository: new InMemoryWorkflowsRepository(),
    });

    expect(connectorExecutionPort.validateDeclarations).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'mock_kyc_1', id: 'mock_kyc_1', type: 'kyc' }),
    ]);
  });

  it('fails to start when a stored connector declaration is rejected by its adapter', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      resume: jest.fn(),
      validateDeclarations: jest.fn().mockImplementation(() => {
        throw new Error('Invalid http_request connector config (connector kyc): request.url');
      }),
    } as ConnectorExecutionPort;

    await expect(
      createRegistry({
        files: [createWorkflowFile('fixtures')],
        connectorExecutionPort,
        repository: new InMemoryWorkflowsRepository(),
      }),
    ).rejects.toThrow('Invalid http_request connector config (connector kyc): request.url');
  });

  it('fails startup and persists nothing when a file names an unregistered errorHandler', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      resume: jest.fn(),
      validateDeclarations: jest.fn().mockImplementation(() => {
        throw new Error('Unknown error handler id: unregistered-handler');
      }),
    } as ConnectorExecutionPort;
    const workflowsRepository = new InMemoryWorkflowsRepository();

    await expect(
      createRegistry({
        files: [createWorkflowFile('fixtures')],
        connectorExecutionPort,
        repository: workflowsRepository,
      }),
    ).rejects.toThrow('Unknown error handler id: unregistered-handler');

    expect(workflowsRepository.publishFromFiles).not.toHaveBeenCalled();
    expect(workflowsRepository.rows.size).toBe(0);
  });

  describe('sourceKey uniqueness', () => {
    it('fails startup when two workflow documents declare the same sourceKey', async () => {
      const registryPromise = createRegistry({
        files: [
          createWorkflowFileWithUniformSourceKey('users', 'sumsub-key', { id: 'first' }),
          createWorkflowFileWithUniformSourceKey('users', 'sumsub-key', { id: 'second' }),
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      await expect(registryPromise).rejects.toThrow(DuplicateWorkflowSourceKeyError);
      await expect(registryPromise).rejects.toMatchObject({
        firstWorkflowId: 'first',
        secondWorkflowId: 'second',
        sourceKey: 'sumsub-key',
      });
    });

    it('accepts the same sourceKey repeated on two connector declarations within one document', async () => {
      const registry = await createRegistry({
        files: [
          createWorkflowFileWithUniformSourceKey('users', 'sumsub-key', { id: 'shared-key' }),
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      expect(await registry.getById('shared-key')).toBeInstanceOf(Workflow);
    });

    it('accepts distinct sourceKeys declared across workflow documents', async () => {
      const registry = await createRegistry({
        files: [
          createWorkflowFileWithUniformSourceKey('users', 'key-one', { id: 'doc-one' }),
          createWorkflowFileWithUniformSourceKey('users', 'key-two', { id: 'doc-two' }),
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      expect(await registry.getById('doc-one')).toBeInstanceOf(Workflow);
      expect(await registry.getById('doc-two')).toBeInstanceOf(Workflow);
    });

    it('ignores a connector declaration with no sourceKey', async () => {
      const registry = await createRegistry({
        files: [
          createWorkflowFile('users', { id: 'no-key-one' }),
          createWorkflowFile('users', { id: 'no-key-two' }),
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      expect(await registry.getById('no-key-one')).toBeInstanceOf(Workflow);
      expect(await registry.getById('no-key-two')).toBeInstanceOf(Workflow);
    });

    it('fails startup when a sourceKey collides across a primary and a fallback', async () => {
      const primaryDefinition = createWorkflowDefinition({
        id: 'primary-doc',
        steps: asCustomSteps([
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: { type: 'text', required: true, validation: { format: 'email' } },
            },
            connectors: [
              {
                name: 'mock_kyc_1',
                id: 'mock_kyc_1',
                type: 'kyc',
                order: 1,
                fieldMapping: { email: 'email' },
                config: { sourceKey: 'shared-key' },
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ]),
      });
      const fallbackDefinition = createWorkflowDefinition({
        id: 'fallback-doc',
        steps: asCustomSteps([
          {
            name: 'collect_email',
            status: 'awaiting_user',
            data: {
              email: { type: 'text', required: true, validation: { format: 'email' } },
            },
            connectors: [
              {
                name: 'mock_kyc_1',
                id: 'mock_kyc_1',
                type: 'kyc',
                order: 1,
                fieldMapping: { email: 'email' },
                fallback: [
                  {
                    name: 'mock_kyc_1_fallback',
                    id: 'mock_kyc_2',
                    type: 'kyc',
                    config: { sourceKey: 'shared-key' },
                  },
                ],
              },
            ],
            transitions: [{ status: 'success', target: 'approved' }],
          },
          { name: 'approved', status: 'approved', data: {}, transitions: [] },
        ]),
      });

      const registryPromise = createRegistry({
        files: [
          {
            scope: 'users',
            filePath: '/workflows/users/primary-doc.workflow.json',
            workflowId: 'primary-doc',
            version: 1,
            definition: primaryDefinition,
          },
          {
            scope: 'users',
            filePath: '/workflows/users/fallback-doc.workflow.json',
            workflowId: 'fallback-doc',
            version: 1,
            definition: fallbackDefinition,
          },
        ],
        repository: new InMemoryWorkflowsRepository(),
      });

      await expect(registryPromise).rejects.toThrow(DuplicateWorkflowSourceKeyError);
      await expect(registryPromise).rejects.toMatchObject({
        firstWorkflowId: 'primary-doc',
        secondWorkflowId: 'fallback-doc',
        sourceKey: 'shared-key',
      });
    });
  });

  it('loads every committed workflow with the real connector adapters and no configured secrets', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('{}'),
      getOrThrow: jest.fn().mockReturnValue(5000),
    } as unknown as ConfigService<AppConfig, true>;
    const connectorExecutionPort = new WorkflowConnectorExecutorService(
      [new HttpRequestConnector(configService)] as ConnectorAdapterCollection,
      [new FallbackOnErrorHandler(), new RetryThenFallbackHandler(), new ContinueOnErrorHandler()],
      { logConnectorFailure: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
      {} as DataSource,
    );
    const fileLoader = new WorkflowFileLoaderService({
      get: jest.fn().mockReturnValue(undefined),
    } as unknown as ConfigService);

    const registry = await createRegistry({
      files: fileLoader.load(),
      connectorExecutionPort,
      repository: new InMemoryWorkflowsRepository(),
    });

    expect(await registry.getById('http-request', 1)).toBeInstanceOf(Workflow);
  });
});
