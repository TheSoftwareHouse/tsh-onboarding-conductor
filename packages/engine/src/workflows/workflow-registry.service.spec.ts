import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { DataSource } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import { HttpRequestConnector } from '../connectors/adapters/built-in/http-request.connector';
import type { ConnectorSettingsService } from '../connectors/connector-settings.service';
import type { ConnectorAdapterCollection } from '../connectors/ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { Workflow } from './domain/workflow';
import type { WorkflowEntity } from './entity/workflow.entity';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowFileLoaderService, type WorkflowFile } from './workflow-file-loader.service';
import { WorkflowRegistryService } from './workflow-registry.service';
import type { WorkflowScope } from './workflow-scope';
import type { WorkflowStatus } from './workflow-status';
import { WorkflowsRepository } from './workflows.repository';

const BASE_WORKFLOW_PATH = resolve(__dirname, '../../../../workflows/fixtures/base.workflow.json');

const createWorkflowDefinition = (overrides: Record<string, unknown> = {}) => ({
  ...(JSON.parse(readFileSync(BASE_WORKFLOW_PATH, 'utf8')) as Record<string, unknown>),
  ...overrides,
});

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
    definition,
  };
};

const createStoredWorkflow = (
  workflowId: string,
  version: number,
  status: WorkflowStatus,
  scope: WorkflowScope = 'users',
): WorkflowEntity =>
  ({
    workflowId,
    version,
    scope,
    status,
    definition: createWorkflowDefinition({ id: workflowId, version }),
  }) as WorkflowEntity;

/**
 * Stands in for the real table: `upsertFromFiles` keys rows by `(workflow_id, version)`
 * exactly like the natural primary key does, so seeding twice cannot duplicate, and
 * it only sets `status` on insert exactly like the real `ON CONFLICT` clause does.
 * Every read goes through it, so a test that mutates `rows` after startup is
 * asserting exactly what a UI edit against the live table would do.
 */
class InMemoryWorkflowsRepository {
  readonly rows = new Map<string, WorkflowEntity>();

  constructor(storedRows: readonly WorkflowEntity[] = []) {
    for (const row of storedRows) {
      this.rows.set(`${row.workflowId}@${row.version}`, row);
    }
  }

  upsertFromFiles = jest.fn(async (_manager: unknown, files: readonly WorkflowFile[]) => {
    for (const file of files) {
      const revisionKey = `${file.workflowId}@${file.version}`;

      this.rows.set(revisionKey, {
        workflowId: file.workflowId,
        version: file.version,
        scope: file.scope,
        status: this.rows.get(revisionKey)?.status ?? 'published',
        definition: file.definition,
      } as WorkflowEntity);
    }
  });

  findAll = jest.fn(async (_manager: unknown, scopes: readonly WorkflowScope[]) =>
    this.inScope(scopes),
  );

  findRevision = jest.fn(
    async (
      _manager: unknown,
      scopes: readonly WorkflowScope[],
      workflowId: string,
      version: number,
    ) =>
      this.inScope(scopes).find(
        (row) => row.workflowId === workflowId && row.version === version,
      ) ?? null,
  );

  findLatestPublished = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], workflowId: string) =>
      this.inScope(scopes)
        .filter((row) => row.workflowId === workflowId && row.status === 'published')
        .sort((left, right) => right.version - left.version)[0] ?? null,
  );

  countRevisions = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[], workflowId: string) =>
      this.inScope(scopes).filter((row) => row.workflowId === workflowId).length,
  );

  countPublished = jest.fn(
    async (_manager: unknown, scopes: readonly WorkflowScope[]) =>
      this.inScope(scopes).filter((row) => row.status === 'published').length,
  );

  private inScope(scopes: readonly WorkflowScope[]): WorkflowEntity[] {
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
    });
  });

  it('publishes discovered files into the database before serving them', () => {
    expect(repository.upsertFromFiles).toHaveBeenCalledTimes(1);
    expect(repository.upsertFromFiles.mock.calls[0][1]).toEqual([
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
      expect.objectContaining({ name: 'tsh_kyc_1', id: 'mock_kyc_1', type: 'kyc' }),
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

  it('loads every committed workflow with the real connector adapters and no configured secrets', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('{}'),
      getOrThrow: jest.fn().mockReturnValue(5000),
    } as unknown as ConfigService<AppConfig, true>;
    // validateDeclaration (exercised by loading the registry below) never needs stored
    // settings — it runs in 'shape' mode — so this stub ConnectorSettingsService is never
    // actually called.
    const connectorSettingsService = { resolve: jest.fn() } as unknown as ConnectorSettingsService;
    const connectorExecutionPort = new WorkflowConnectorExecutorService([
      new HttpRequestConnector(configService, connectorSettingsService),
    ] as ConnectorAdapterCollection);
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
