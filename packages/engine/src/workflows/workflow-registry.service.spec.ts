import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import baseWorkflowConfig from './config/base-workflow.config.json';
import { Workflow } from './domain/workflow';
import { WorkflowRegistryService } from './workflow-registry.service';

describe('WorkflowRegistryService', () => {
  let service: WorkflowRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowRegistryService],
    }).compile();

    service = module.get(WorkflowRegistryService);
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

  it('returns stable not-found for an unknown workflow id', () => {
    expect(() => service.getById('unknown')).toThrow(NotFoundException);
    expect(() => service.getById('unknown')).toThrow('WORKFLOW_NOT_FOUND');
  });

  it('rejects a workflow version mismatch with the stable configuration error', () => {
    expect(() => service.getById('base', 2)).toThrow(WorkflowInvalidError);
    expect(() => service.getById('base', 2)).toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when the imported workflow definition is invalid', () => {
    const invalidDefinition = {
      ...baseWorkflowConfig,
      steps: [],
    };

    expect(() => new WorkflowRegistryService(invalidDefinition)).toThrow(WorkflowInvalidError);
    expect(() => new WorkflowRegistryService(invalidDefinition)).toThrow('WORKFLOW_INVALID');
  });
});
