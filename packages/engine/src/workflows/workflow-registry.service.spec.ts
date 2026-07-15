import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowRegistryService } from './workflow-registry.service';
import { beforeEach, describe, it } from 'node:test';

describe('WorkflowRegistryService', () => {
  let service: WorkflowRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowRegistryService],
    }).compile();

    service = module.get(WorkflowRegistryService);
  });

  it('returns the base workflow configuration', () => {
    const workflow = service.findById('base');

    expect(workflow).toEqual({
      id: 'base',
      version: 1,
      name: 'Base',
      steps: [],
    });
    expect(Object.keys(workflow ?? {}).sort()).toEqual(['id', 'name', 'steps', 'version']);
    expect(workflow).not.toHaveProperty('systemWebhooks');
  });

  it('returns empty steps for the base workflow', () => {
    expect(service.findById('base')?.steps).toHaveLength(0);
  });

  it('returns no configuration for an unknown workflow id', () => {
    expect(service.findById('unknown')).toBeUndefined();
  });
});
