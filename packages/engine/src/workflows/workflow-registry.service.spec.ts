import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import type { AppConfig } from '../config/app.config';
import { HttpRequestConnector } from '../connectors/adapters/production/http-request.connector';
import { ConnectorTier } from '../connectors/ports/connector-adapter.port';
import type {
  ConnectorAdapter,
  ConnectorAdapterCollection,
} from '../connectors/ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { WorkflowConnectorExecutorService } from '../connectors/workflow-connector-executor.service';
import { Workflow } from './domain/workflow';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { NoWorkflowsConfiguredError } from './errors/no-workflows-configured.error';
import { WorkflowsDirectoryEmptyError } from './errors/workflows-directory-empty.error';
import { WorkflowsDirectoryReadError } from './errors/workflows-directory-read.error';
import { WorkflowRegistryService } from './workflow-registry.service';

// The checked-in fixture workflows. The guard below asserts they all still load; everything else
// writes its own temporary directory.
const sharedWorkflowFixturePath = resolve(__dirname, '../../workflows/fixtures/base.workflow.json');

// Only the user directory is configurable; built-in and fixtures ship at fixed paths inside the
// package, so tests toggle fixtures rather than pointing them somewhere.
type WorkflowSourceSettings = { user?: string; fixtures?: boolean };

const workflowConfigService = (settings: WorkflowSourceSettings) => {
  const values: Record<string, string | boolean | undefined> = {
    WORKFLOWS_DIR: settings.user,
    FIXTURE_WORKFLOWS_ENABLED: settings.fixtures === true,
  };

  return { get: jest.fn((key: string) => values[key]) };
};

const EXAMPLE_SANDBOX_CONNECTOR_TYPES = [
  'mock_kyc_1',
  'mock_kyc_2',
  'mock_email_otp',
  'mock_sms_otp',
  'mock_sumsub_file_upload',
] as const;

const EXAMPLE_PRODUCTION_CONNECTOR_TYPES = [
  'sendgrid_email',
  'twilio_verify',
  'smtp_email',
] as const;

const stubAdapter = (type: string, tier: ConnectorTier): ConnectorAdapter => ({
  name: type,
  type,
  tier,
  execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
});

const readWorkflowFixture = () =>
  JSON.parse(readFileSync(sharedWorkflowFixturePath, 'utf8')) as Record<string, unknown>;

const createWorkflowFixture = (overrides: Record<string, unknown> = {}) => ({
  ...readWorkflowFixture(),
  ...overrides,
});

const writeWorkflowFixture = (
  workflowsDir: string,
  fileName: string,
  overrides: Record<string, unknown> = {},
) => {
  writeFileSync(join(workflowsDir, fileName), JSON.stringify(createWorkflowFixture(overrides)));
};

async function expectRejectedError<T extends Error>(
  action: () => Promise<unknown>,
  ErrorType: new (...args: never[]) => T,
  message: string,
): Promise<void> {
  let error: unknown;

  try {
    await action();
  } catch (e) {
    error = e;
  }

  expect(error).toBeInstanceOf(ErrorType);
  expect((error as Error).message).toBe(message);
}

describe('WorkflowRegistryService', () => {
  let service: WorkflowRegistryService;
  let tempDir: string;

  const createRegistryWithDirectory = async (
    workflowsDir: string,
  ): Promise<WorkflowRegistryService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ user: workflowsDir }),
        },
      ],
    }).compile();

    return module.get(WorkflowRegistryService);
  };

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'workflow-registry-'));
    writeWorkflowFixture(tempDir, 'base.workflow.json');

    service = await createRegistryWithDirectory(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns a workflow domain instance for its pinned version', () => {
    const workflow = service.getById('base', 1);

    expect(workflow).toBeInstanceOf(Workflow);
    expect(workflow.initialize()).toEqual({
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
    });
  });

  it('passes the injected connector execution port to created workflows', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      resume: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
    } as ConnectorExecutionPort;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ user: tempDir }),
        },
        { provide: WORKFLOW_CONNECTOR_EXECUTION_PORT, useValue: connectorExecutionPort },
      ],
    }).compile();

    const registry = module.get(WorkflowRegistryService);
    const workflow = registry.getById('base', 1);

    expect(
      (workflow as unknown as { connectorExecutionPort?: ConnectorExecutionPort })
        .connectorExecutionPort,
    ).toBe(connectorExecutionPort);
  });

  it('loads every shipped fixture workflow against the connector types the engine registers', async () => {
    const configService = {
      get: jest.fn().mockReturnValue('{}'),
      getOrThrow: jest.fn().mockReturnValue(5000),
    } as unknown as ConfigService<AppConfig, true>;

    // HttpRequestConnector is the only adapter with a validateDeclaration hook, so it is the one
    // that has to be real. The rest stand in by type: loading now fails for any example that
    // declares a type the engine does not register, so a new example type must be added here
    // deliberately.
    const connectorExecutionPort = new WorkflowConnectorExecutorService([
      new HttpRequestConnector(configService),
      ...EXAMPLE_SANDBOX_CONNECTOR_TYPES.map((type) => stubAdapter(type, ConnectorTier.SANDBOX)),
      ...EXAMPLE_PRODUCTION_CONNECTOR_TYPES.map((type) =>
        stubAdapter(type, ConnectorTier.PRODUCTION),
      ),
    ] as ConnectorAdapterCollection);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ fixtures: true }),
        },
        { provide: WORKFLOW_CONNECTOR_EXECUTION_PORT, useValue: connectorExecutionPort },
      ],
    }).compile();

    const registry = module.get(WorkflowRegistryService);

    expect(registry.getById('http-request', 1)).toBeInstanceOf(Workflow);
  });

  it('validates every step connector declaration while loading workflows', async () => {
    const connectorExecutionPort = {
      execute: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      resume: jest.fn().mockResolvedValue(ConnectorExecutionResult.accepted()),
      validateDeclarations: jest.fn(),
    } as ConnectorExecutionPort;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ user: tempDir }),
        },
        { provide: WORKFLOW_CONNECTOR_EXECUTION_PORT, useValue: connectorExecutionPort },
      ],
    }).compile();

    module.get(WorkflowRegistryService);

    expect(connectorExecutionPort.validateDeclarations).toHaveBeenCalled();
    expect(connectorExecutionPort.validateDeclarations).toHaveBeenCalledWith([
      expect.objectContaining({ name: 'tsh_kyc_1', type: 'mock_kyc_1' }),
    ]);
  });

  it('fails to load when a connector declaration is rejected by its adapter', async () => {
    const connectorExecutionPort = {
      execute: jest.fn(),
      resume: jest.fn(),
      validateDeclarations: jest.fn().mockImplementation(() => {
        throw new Error('Invalid http_request connector config (connector kyc): request.url');
      }),
    } as ConnectorExecutionPort;

    const moduleBuilder = Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ user: tempDir }),
        },
        { provide: WORKFLOW_CONNECTOR_EXECUTION_PORT, useValue: connectorExecutionPort },
      ],
    });

    await expect(moduleBuilder.compile()).rejects.toThrow(
      'Invalid http_request connector config (connector kyc): request.url',
    );
  });

  it('fails fast when no workflow source is configured', async () => {
    const moduleBuilder = Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        { provide: ConfigService, useValue: workflowConfigService({}) },
      ],
    });

    await expect(moduleBuilder.compile()).rejects.toThrow(NoWorkflowsConfiguredError);
  });

  it('starts with only the shipped built-in directory, which holds no workflows yet', async () => {
    const moduleBuilder = Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        { provide: ConfigService, useValue: workflowConfigService({}) },
      ],
    });

    // Built-in is always a source and is allowed to be empty, so an engine with no user
    // directory and no fixtures has nothing to serve rather than failing to read a directory.
    await expect(moduleBuilder.compile()).rejects.toThrow(NoWorkflowsConfiguredError);
  });

  it('reports the sources a workflow id collides across', async () => {
    // tempDir holds a copy of the shipped `base` fixture, so enabling fixtures collides with it.
    const moduleBuilder = Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
        {
          provide: ConfigService,
          useValue: workflowConfigService({ user: tempDir, fixtures: true }),
        },
      ],
    });

    await expect(moduleBuilder.compile()).rejects.toThrow(
      'Duplicate workflow id=base declared by the user and fixtures sources',
    );
  });

  it('returns stable not-found for an unknown workflow id', () => {
    expect(() => service.getById('unknown')).toThrow(NotFoundException);
    expect(() => service.getById('unknown')).toThrow(WorkflowNotFoundException);
    expect(() => service.getById('unknown')).toThrow('WORKFLOW_NOT_FOUND');
  });

  it('rejects a workflow version mismatch with the stable configuration error', () => {
    expect(() => service.getById('base', 2)).toThrow(WorkflowInvalidError);
    expect(() => service.getById('base', 2)).toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when a direct JSON file has schema-invalid workflow data', async () => {
    rmSync(join(tempDir, 'base.workflow.json'));
    writeWorkflowFixture(tempDir, 'invalid.workflow.json', {
      id: 'invalid',
      steps: undefined,
    });

    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow(WorkflowInvalidError);
    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when a direct JSON file contains a targetless manual transition', async () => {
    rmSync(join(tempDir, 'base.workflow.json'));
    writeWorkflowFixture(tempDir, 'manual.workflow.json', {
      id: 'manual-review',
      name: 'Manual Review',
      initial: 'review',
      steps: [
        {
          name: 'review',
          status: 'awaiting_manual_review',
          data: {},
          transitions: [{ status: 'manual.approve' }],
        },
      ],
    });

    await expect(createRegistryWithDirectory(tempDir)).rejects.toMatchObject({
      code: 'WORKFLOW_INVALID',
      reason: 'INVALID_SHAPE',
    });
  });

  it('loads multiple direct JSON files and ignores non-JSON or nested entries', async () => {
    writeFileSync(join(tempDir, 'ignore.txt'), 'ignored');
    const nestedDir = join(tempDir, 'nested');
    mkdirSync(nestedDir);
    writeWorkflowFixture(nestedDir, 'nested.workflow.json');

    writeWorkflowFixture(tempDir, 'secondary.workflow.json', {
      id: 'secondary',
      name: 'Secondary',
    });

    const registry = await createRegistryWithDirectory(tempDir);
    expect(registry.getById('base')).toBeInstanceOf(Workflow);
    expect(registry.getById('secondary')).toBeInstanceOf(Workflow);
  });

  it('fails eagerly when directory has no direct JSON files', async () => {
    rmSync(join(tempDir, 'base.workflow.json'));
    writeFileSync(join(tempDir, 'ignore.txt'), 'ignored');
    const nestedDir = join(tempDir, 'nested');
    mkdirSync(nestedDir);
    writeWorkflowFixture(nestedDir, 'nested.workflow.json');

    await expectRejectedError(
      () => createRegistryWithDirectory(tempDir),
      WorkflowsDirectoryEmptyError,
      `Workflows directory is empty or has no direct JSON files: ${tempDir}`,
    );
  });

  it('fails eagerly for missing workflow directory', async () => {
    const missingDir = join(tempDir, 'missing');

    await expectRejectedError(
      () => createRegistryWithDirectory(missingDir),
      WorkflowsDirectoryReadError,
      `Cannot read workflows directory: ${missingDir}`,
    );
  });

  it('fails eagerly for inaccessible workflow directory', async () => {
    const inaccessibleDir = join(tempDir, 'inaccessible');
    mkdirSync(inaccessibleDir);
    chmodSync(inaccessibleDir, 0o000);

    try {
      await expectRejectedError(
        () => createRegistryWithDirectory(inaccessibleDir),
        WorkflowsDirectoryReadError,
        `Cannot read workflows directory: ${inaccessibleDir}`,
      );
    } finally {
      chmodSync(inaccessibleDir, 0o700);
    }
  });

  it('fails eagerly for non-directory workflow path', async () => {
    const filePath = join(tempDir, 'file-as-dir');
    writeFileSync(filePath, 'not a directory');

    await expectRejectedError(
      () => createRegistryWithDirectory(filePath),
      WorkflowsDirectoryReadError,
      `Cannot read workflows directory: ${filePath}`,
    );
  });

  it('fails eagerly when direct JSON file has malformed JSON', async () => {
    rmSync(join(tempDir, 'base.workflow.json'));
    writeFileSync(join(tempDir, 'broken.workflow.json'), '{"id":');

    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow(WorkflowInvalidError);
    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when duplicate workflow ids are discovered with the same version', async () => {
    writeWorkflowFixture(tempDir, 'base.duplicate.workflow.json', {
      id: 'base',
      version: 1,
    });

    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow(WorkflowInvalidError);
    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when duplicate workflow ids are discovered with different versions', async () => {
    writeWorkflowFixture(tempDir, 'base.v2.workflow.json', {
      id: 'base',
      version: 2,
    });

    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow(WorkflowInvalidError);
    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow('WORKFLOW_INVALID');
  });
});
