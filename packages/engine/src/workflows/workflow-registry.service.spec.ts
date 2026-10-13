import type { EntityManager } from 'typeorm';
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
  type ConnectorAdapterSummary,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { Workflow } from './domain/workflow';
import type { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { DuplicateWorkflowSourceKeyError } from './errors/duplicate-workflow-source-key.error';
import { WorkflowConnectorDeclarationInvalidException } from './errors/workflow-connector-declaration-invalid.exception';
import { WorkflowInvalidException } from './errors/workflow-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowVersionNotPublishedException } from './errors/workflow-version-not-published.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
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
    workflow: { workflowId: `wf-${name}`, key: name, name: label, scope },
    version,
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
    const skipped: WorkflowFile[] = [];

    for (const file of [...files].sort((left, right) => left.version - right.version)) {
      const revisionKey = this.keyOf(file.workflowId, file.version);

      if (this.rows.has(revisionKey)) {
        continue;
      }

      const family = [...this.rows.values()].find((row) => row.workflow.key === file.workflowId);
      const workflowId = family?.workflowId ?? `wf-${file.workflowId}`;
      const workflow = family?.workflow ?? {
        workflowId,
        key: file.workflowId,
        name: null,
        scope: file.scope,
      };

      if (file.name !== undefined) {
        workflow.name = file.name;
      }

      this.rows.set(revisionKey, {
        workflowVersionId: revisionKey,
        workflowId,
        workflow,
        version: file.version,
        status: 'published',
        definition: file.definition,
      } as unknown as WorkflowVersionEntity);
    }

    return { skipped };
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

  listVersions = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], name: string) =>
      this.inScope(scopes)
        .filter((row) => row.workflow.key === name)
        .sort((left, right) => right.version - left.version),
  );

  listForAdmin = jest.fn(async () => ({
    items: [] as unknown[],
    total: 0,
    page: 1,
    limit: 20,
    totalPages: 0,
  }));

  private keyOf(name: string, version: number): string {
    return `${name}@${version}`;
  }

  private inScope(scopes: readonly WorkflowScope[]): WorkflowVersionEntity[] {
    return [...this.rows.values()].filter((row) => scopes.includes(row.workflow.scope));
  }
}

/** Stands in for the selections table: rows are read by family, or all at once for the boot sweep. */
class InMemoryConnectorSelectionsRepository {
  constructor(
    readonly rows: Array<{
      workflowId: string;
      stepName: string;
      connectorId: string;
      workflow: { key: string };
    }> = [],
  ) {}

  findByWorkflowId = jest.fn(async (_manager: unknown, workflowId: string) =>
    this.rows.filter((row) => row.workflowId === workflowId),
  );

  findAll = jest.fn(async () => this.rows);
}

const adapterSummary = (
  id: string,
  overrides: Partial<ConnectorAdapterSummary> = {},
): ConnectorAdapterSummary => ({
  id,
  type: 'kyc',
  supportsAsyncCallback: false,
  scope: 'built-in',
  callbackFields: [],
  ...overrides,
});

describe('WorkflowRegistryService', () => {
  let repository: InMemoryWorkflowsRepository;
  let service: WorkflowRegistryService;

  const createRegistry = async (options: {
    files: WorkflowFile[];
    nodeEnv?: string;
    connectorExecutionPort?: ConnectorExecutionPort;
    repository?: InMemoryWorkflowsRepository;
    selections?: InMemoryConnectorSelectionsRepository;
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
        {
          provide: WorkflowConnectorSelectionsRepository,
          useValue: options.selections ?? new InMemoryConnectorSelectionsRepository(),
        },
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

  describe('drafts', () => {
    const createDraftRegistry = (draft = createStoredWorkflow('drafted', 2, 'draft')) =>
      createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([
          createStoredWorkflow('drafted', 1, 'published'),
          draft,
        ]),
      });

    it('refuses to start or resolve a pinned draft', async () => {
      const registry = await createDraftRegistry();

      await expect(registry.resolveForStart('drafted', 2)).rejects.toThrow(
        WorkflowVersionNotPublishedException,
      );
      await expect(registry.getById('drafted', 2)).rejects.toThrow(
        WorkflowVersionNotPublishedException,
      );
    });

    it('still resolves a draft row by its version id', async () => {
      const registry = await createDraftRegistry();

      expect(await registry.getByVersionId('drafted@2')).toBeInstanceOf(Workflow);
    });

    it('boots with a stored draft that does not compile', async () => {
      const invalidDraft = createStoredWorkflow('drafted', 2, 'draft');
      invalidDraft.definition = { id: 'drafted', version: 2 };

      await expect(createDraftRegistry(invalidDraft)).resolves.toBeDefined();
    });

    it('boots with a draft whose sourceKey duplicates another workflow', async () => {
      const draft = createStoredWorkflow('drafted', 2, 'draft');
      draft.definition = withUniformSourceKey(draft.definition, 'shared-key');
      const other = createStoredWorkflow('other', 1, 'published');
      other.definition = withUniformSourceKey(other.definition, 'shared-key');
      const registry = await createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([draft, other]),
      });

      const fresh = withUniformSourceKey(createWorkflowDefinition({ id: 'fresh' }), 'fresh-key');

      await expect(registry.validateDefinition(fresh)).resolves.toBeDefined();
    });

    it('logs every file the publish skipped at error level', async () => {
      const file = createWorkflowFile('users', { id: 'drafted', version: 2 });
      const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
      const workflowsRepository = new InMemoryWorkflowsRepository();
      workflowsRepository.publishFromFiles.mockResolvedValueOnce({ skipped: [file] });

      await createRegistry({ files: [file], repository: workflowsRepository });

      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`drafted v2 from ${file.filePath}`),
      );
      errorSpy.mockRestore();
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

  describe('listForAdmin', () => {
    it('lists against the active scopes and reports the envelope the repository resolved', async () => {
      const query = { page: 1, limit: 20 } as never;
      repository.listForAdmin.mockResolvedValueOnce({
        items: [{ workflowId: 'base', name: null }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });

      const result = await service.listForAdmin(query);

      expect(repository.listForAdmin).toHaveBeenCalledWith(
        expect.anything(),
        ['built-in', 'fixtures', 'users'],
        query,
      );
      expect(result).toEqual({
        items: [{ workflowId: 'base', name: null }],
        meta: { pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } },
      });
    });

    it('excludes fixtures from the scopes it passes on production', async () => {
      const productionRegistry = await createRegistry({ files: [], nodeEnv: 'production' });

      await productionRegistry.listForAdmin({ page: 1, limit: 20 } as never);

      expect(repository.listForAdmin).toHaveBeenCalledWith(
        expect.anything(),
        ['built-in', 'users'],
        expect.anything(),
      );
    });
  });

  describe('describeForAdmin', () => {
    const createRetiredRegistry = () =>
      createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([
          createStoredWorkflow('discontinued', 1, 'retired'),
          createStoredWorkflow('discontinued', 2, 'published'),
        ]),
      });

    it('returns the definition of a pinned retired revision that getById still refuses', async () => {
      const registry = await createRetiredRegistry();

      await expect(registry.describeForAdmin('discontinued', 1)).resolves.toEqual(
        expect.objectContaining({ workflowId: 'discontinued', workflowVersion: 1 }),
      );
      await expect(registry.getById('discontinued', 1)).rejects.toThrow(WorkflowRetiredException);
      await expect(registry.resolveForStart('discontinued', 1)).rejects.toThrow(
        WorkflowRetiredException,
      );
    });

    it('describes the highest published revision when unpinned, with its authored step types', async () => {
      const registry = await createRetiredRegistry();

      const definition = await registry.describeForAdmin('discontinued');

      expect(definition.workflowVersion).toBe(2);
      expect(definition.steps.every((step) => step.source?.type === 'custom')).toBe(true);
    });

    it('serves a valid draft and reports an invalid one as WORKFLOW_INVALID', async () => {
      const invalidDraft = createStoredWorkflow('drafted', 2, 'draft');
      invalidDraft.definition = { ...invalidDraft.definition, steps: 'nope' };
      const registry = await createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([
          createStoredWorkflow('drafted', 1, 'draft'),
          invalidDraft,
        ]),
      });

      await expect(registry.describeForAdmin('drafted', 1)).resolves.toEqual(
        expect.objectContaining({ workflowId: 'drafted', workflowVersion: 1 }),
      );
      await expect(registry.describeForAdmin('drafted', 2)).rejects.toThrow(
        WorkflowInvalidException,
      );
    });

    it('reports a draft whose connector declaration an adapter refuses', async () => {
      const registry = await createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([createStoredWorkflow('drafted', 1, 'draft')]),
        connectorExecutionPort: {
          execute: jest.fn(),
          resume: jest.fn(),
          validateDeclarations: jest.fn().mockImplementation(() => {
            throw new Error('url must be absolute');
          }),
        } as ConnectorExecutionPort,
      });

      await expect(registry.describeForAdmin('drafted', 1)).rejects.toThrow(
        WorkflowConnectorDeclarationInvalidException,
      );
    });

    it('reports an unknown workflow and an unknown pinned version as misses', async () => {
      await expect(service.describeForAdmin('nope')).rejects.toThrow(WorkflowNotFoundException);
      await expect(service.describeForAdmin('nope', 1)).rejects.toThrow(WorkflowNotFoundException);
      await expect(service.describeForAdmin('base', 9)).rejects.toThrow(
        WorkflowRevisionNotFoundError,
      );
    });
  });

  describe('listVersionsForAdmin', () => {
    it('lists every version whatever its status, newest first', async () => {
      const registry = await createRegistry({
        files: [],
        repository: new InMemoryWorkflowsRepository([
          createStoredWorkflow('versioned', 1, 'retired'),
          createStoredWorkflow('versioned', 3, 'draft'),
          createStoredWorkflow('versioned', 2, 'published'),
        ]),
      });

      const { items } = await registry.listVersionsForAdmin('versioned');

      expect(items.map(({ version, status }) => [version, status])).toEqual([
        [3, 'draft'],
        [2, 'published'],
        [1, 'retired'],
      ]);
    });

    it('reports a workflow with no stored version as not found', async () => {
      await expect(service.listVersionsForAdmin('nope')).rejects.toThrow(WorkflowNotFoundException);
    });

    it('lists against the active scopes', async () => {
      await service.listVersionsForAdmin('base');

      expect(repository.listVersions).toHaveBeenCalledWith(
        expect.anything(),
        ['built-in', 'fixtures', 'users'],
        'base',
      );
    });
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
    await expect(registry.getById('versioned', 3)).rejects.toThrow(
      WorkflowVersionNotPublishedException,
    );
  });

  it('refuses to serve a workflow whose every revision is still a draft', async () => {
    const registry = await createRegistry({
      files: [],
      repository: new InMemoryWorkflowsRepository([createStoredWorkflow('drafted', 1, 'draft')]),
    });

    await expect(registry.getById('drafted')).rejects.toThrow(WorkflowNotFoundException);
    await expect(registry.getById('drafted', 1)).rejects.toThrow(
      WorkflowVersionNotPublishedException,
    );
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
    it('reads the stored workflows through a manager passed to validateDefinition', async () => {
      const repository = new InMemoryWorkflowsRepository();
      const registry = await createRegistry({ files: [], repository });
      const manager = {} as EntityManager;

      await registry.validateDefinition(createWorkflowDefinition({ id: 'fresh' }), manager);

      expect(repository.findAll).toHaveBeenLastCalledWith(manager, expect.anything());
    });

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

  describe('connector selections', () => {
    const selection = (connectorId: string, stepName = 'collect_email') => ({
      workflowId: 'wf-base',
      stepName,
      connectorId,
      workflow: { key: 'base' },
    });
    const port = (adapters: readonly ConnectorAdapterSummary[]): ConnectorExecutionPort => ({
      execute: jest.fn(),
      resume: jest.fn(),
      listAdapters: () => adapters,
    });
    const KYC_ADAPTERS = [adapterSummary('mock_kyc_1'), adapterSummary('mock_kyc_2')];
    const createSelectingRegistry = (
      adapters: readonly ConnectorAdapterSummary[] = KYC_ADAPTERS,
      rows = [selection('mock_kyc_2')],
      nodeEnv?: string,
    ) =>
      createRegistry({
        files: [createWorkflowFile('users')],
        connectorExecutionPort: port(adapters),
        repository: new InMemoryWorkflowsRepository(),
        selections: new InMemoryConnectorSelectionsRepository(rows),
        nodeEnv,
      });
    const primaryId = (workflow: Workflow): string | undefined =>
      workflow.findStep('collect_email')?.connectors[0].id;

    it('applies the family selection on getById, getByVersionId and resolveForStart', async () => {
      const registry = await createSelectingRegistry();

      expect(primaryId(await registry.getById('base', 1))).toBe('mock_kyc_2');
      expect(primaryId(await registry.getByVersionId('base@1'))).toBe('mock_kyc_2');
      expect(primaryId((await registry.resolveForStart('base')).workflow)).toBe('mock_kyc_2');
    });

    it('reads the selection per resolution, inside the transaction the caller passes', async () => {
      const selections = new InMemoryConnectorSelectionsRepository([selection('mock_kyc_2')]);
      const registry = await createRegistry({
        files: [createWorkflowFile('users')],
        connectorExecutionPort: port(KYC_ADAPTERS),
        repository: new InMemoryWorkflowsRepository(),
        selections,
      });
      const manager = {} as never;
      selections.findByWorkflowId.mockClear();

      await registry.getById('base', 1, manager);
      selections.rows.length = 0;

      expect(selections.findByWorkflowId).toHaveBeenCalledWith(manager, 'wf-base');
      expect(primaryId(await registry.getById('base', 1))).toBe('mock_kyc_1');
    });

    it('serves the authored connector when the family has no selection', async () => {
      const registry = await createSelectingRegistry(KYC_ADAPTERS, []);

      expect(primaryId(await registry.getById('base', 1))).toBe('mock_kyc_1');
    });

    it('reports the selection and the selectable ids on describeForAdmin', async () => {
      const registry = await createSelectingRegistry([...KYC_ADAPTERS, adapterSummary('other')]);

      const definition = await registry.describeForAdmin('base', 1);
      const connector = definition.steps[0].connectors[0];

      expect(connector).toEqual(
        expect.objectContaining({
          id: 'mock_kyc_2',
          authoredId: 'mock_kyc_1',
          selected: true,
          selectableIds: ['mock_kyc_1', 'mock_kyc_2', 'other'],
        }),
      );
    });

    it('leaves the compile dry run on the authored definition', async () => {
      const registry = await createSelectingRegistry();
      const document = createWorkflowDefinition();

      const normalized = await registry.validateDefinition(document);

      expect(normalized.steps[0].connectors[0].id).toBe('mock_kyc_1');
    });

    it('builds the selection rules over the active scopes, so production hides fixture adapters', async () => {
      const adapters = [
        adapterSummary('real_kyc'),
        adapterSummary('mock_kyc_1', { scope: 'fixtures' }),
      ];
      const selectable = (registry: WorkflowRegistryService) =>
        registry
          .createConnectorSelectionRules()
          .listSelectableAdapters()
          .map(({ id }) => id);

      const production = await createSelectingRegistry(adapters, [], 'production');
      const development = await createSelectingRegistry(adapters, [], 'development');

      expect(selectable(production)).toEqual(['real_kyc']);
      expect(selectable(development)).toEqual(['real_kyc', 'mock_kyc_1']);
    });

    it('builds rules that list no adapters when the port cannot list them', async () => {
      expect(service.createConnectorSelectionRules().listSelectableAdapters()).toEqual([]);
    });

    it('warns once per selection naming a connector that is not registered, and still boots', async () => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

      const registry = await createSelectingRegistry(KYC_ADAPTERS, [
        selection('mock_kyc_2'),
        selection('removed_kyc', 'accept_terms'),
      ]);

      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining(
          'workflow=base step=accept_terms names connector id=removed_kyc, which is not registered',
        ),
      );
      expect(await registry.getById('base', 1)).toBeInstanceOf(Workflow);
    });
  });

  describe('callback fields guard', () => {
    const kycStep = (
      fields: readonly string[],
      connector: Record<string, unknown> = { async: true },
    ): Array<Record<string, unknown>> =>
      asCustomSteps([
        {
          name: 'kyc',
          status: 'awaiting_user',
          data: Object.fromEntries(
            fields.map((field) => [field, { type: 'text', required: false }]),
          ),
          connectors: [
            {
              name: 'kyc_a',
              id: 'kyc_a',
              type: 'kyc',
              order: 1,
              fieldMapping: {},
              ...connector,
            },
          ],
          transitions: [{ status: 'success', target: 'approved' }],
        },
        { name: 'approved', status: 'approved', data: {}, transitions: [] },
      ]);
    const portWith = (callbackFields: readonly string[]): ConnectorExecutionPort => ({
      execute: jest.fn(),
      resume: jest.fn(),
      listAdapters: () => [
        adapterSummary('kyc_a', { supportsAsyncCallback: true, callbackFields }),
        adapterSummary('kyc_b', { supportsAsyncCallback: true, callbackFields: ['other'] }),
      ],
    });
    const registryFor = (
      steps: Array<Record<string, unknown>>,
      callbackFields: readonly string[],
    ) =>
      createRegistry({
        files: [createWorkflowFile('users', { id: 'guarded', initial: 'kyc', steps })],
        connectorExecutionPort: portWith(callbackFields),
        repository: new InMemoryWorkflowsRepository(),
      });

    it('refuses a step that does not declare a field its async adapter emits', async () => {
      await expect(
        registryFor(kycStep(['kycOutcome']), ['kycOutcome', 'kycAttemptCount']),
      ).rejects.toThrow(
        'connector kyc_a emits callback field "kycAttemptCount" that step "kyc" does not declare',
      );
    });

    it('accepts a step declaring every field its async adapter emits', async () => {
      const registry = await registryFor(kycStep(['kycOutcome', 'kycAttemptCount']), [
        'kycOutcome',
        'kycAttemptCount',
      ]);

      expect(await registry.getById('guarded', 1)).toBeInstanceOf(Workflow);
    });

    it('does not apply to a synchronous declaration of the same adapter', async () => {
      const registry = await registryFor(kycStep([], { async: false }), ['kycOutcome']);

      expect(await registry.getById('guarded', 1)).toBeInstanceOf(Workflow);
    });

    it('holds an async fallback to its own adapter fields', async () => {
      const steps = kycStep(['kycOutcome'], {
        async: true,
        fallback: [{ name: 'kyc_b', id: 'kyc_b', type: 'kyc', fieldMapping: {} }],
      });

      await expect(registryFor(steps, ['kycOutcome'])).rejects.toThrow(
        'connector kyc_b emits callback field "other" that step "kyc" does not declare',
      );
    });

    it('rejects a document dry run the same way', async () => {
      const registry = await registryFor(kycStep(['kycOutcome']), ['kycOutcome']);
      const document = createWorkflowDefinition({
        id: 'guarded',
        initial: 'kyc',
        steps: kycStep([]),
      });

      await expect(registry.validateDefinition(document)).rejects.toThrow(
        'connector kyc_a emits callback field "kycOutcome" that step "kyc" does not declare',
      );
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

    expect(await registry.getById('eu-b2c-individual-kyc-eea', 2)).toBeInstanceOf(Workflow);
  });
});
