import { Test, TestingModule } from '@nestjs/testing';
import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { WorkflowRegistryService } from './workflow-registry.service';

describe('WorkflowRegistryService', () => {
  let service: WorkflowRegistryService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkflowRegistryService],
    }).compile();

    service = module.get(WorkflowRegistryService);
  });

  it('returns the normalized base workflow configuration for its pinned version', () => {
    const workflow = service.findById('base', 1);

    expect(workflow).toMatchObject({
      id: 'base',
      version: 1,
      name: 'Base',
      initial: 'collect_email',
    });
    expect(workflow?.steps.map((step) => step.name)).toEqual([
      'collect_email',
      'accept_terms',
      'approved',
    ]);
    expect(workflow?.steps[0].transitions).toEqual([{ status: 'success', target: 'accept_terms' }]);
    expect(workflow?.steps[1].transitions).toEqual([{ status: 'success', target: 'approved' }]);
    expect(workflow?.steps[2].transitions).toEqual([]);
    expect(workflow).not.toHaveProperty('systemWebhooks');
  });

  it('returns no configuration for an unknown workflow id', () => {
    expect(service.findById('unknown')).toBeUndefined();
  });

  it('rejects a workflow version mismatch with the stable configuration error', () => {
    expect(() => service.findById('base', 2)).toThrow(WorkflowInvalidError);
    expect(() => service.findById('base', 2)).toThrow('WORKFLOW_INVALID');
  });

  it('fails eagerly when the imported workflow definition is invalid', () => {
    const invalidDefinition = {
      ...service.findById('base'),
      steps: [],
    };

    expect(() => new WorkflowRegistryService(invalidDefinition)).toThrow(WorkflowInvalidError);
    expect(() => new WorkflowRegistryService(invalidDefinition)).toThrow('WORKFLOW_INVALID');
  });
});
