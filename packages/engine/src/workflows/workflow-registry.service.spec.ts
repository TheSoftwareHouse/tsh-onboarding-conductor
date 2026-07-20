import { chmodSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import {
  WORKFLOW_CONNECTOR_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { Workflow } from './domain/workflow';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRegistryService } from './workflow-registry.service';

const sharedWorkflowFixturePath = resolve(__dirname, '../../../../workflows/base.workflow.json');

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
          useValue: {
            getOrThrow: jest.fn().mockReturnValue(workflowsDir),
          },
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
      execute: jest.fn().mockResolvedValue(undefined),
    } as ConnectorExecutionPort;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkflowRegistryService,
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

    await expect(createRegistryWithDirectory(tempDir)).rejects.toThrow(
      `Workflows directory is empty or has no direct JSON files: ${tempDir}`,
    );
  });

  it('fails eagerly for missing workflow directory', async () => {
    const missingDir = join(tempDir, 'missing');

    await expect(createRegistryWithDirectory(missingDir)).rejects.toThrow(
      `Cannot read workflows directory: ${missingDir}`,
    );
  });

  it('fails eagerly for inaccessible workflow directory', async () => {
    const inaccessibleDir = join(tempDir, 'inaccessible');
    mkdirSync(inaccessibleDir);
    chmodSync(inaccessibleDir, 0o000);

    try {
      await expect(createRegistryWithDirectory(inaccessibleDir)).rejects.toThrow(
        `Cannot read workflows directory: ${inaccessibleDir}`,
      );
    } finally {
      chmodSync(inaccessibleDir, 0o700);
    }
  });

  it('fails eagerly for non-directory workflow path', async () => {
    const filePath = join(tempDir, 'file-as-dir');
    writeFileSync(filePath, 'not a directory');

    await expect(createRegistryWithDirectory(filePath)).rejects.toThrow(
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
