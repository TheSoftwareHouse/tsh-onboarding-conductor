import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowsController } from './workflows.controller';
import type { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowRegistryService } from './workflow-registry.service';

// The read routes under test never reach the compiler, so it needs no behaviour here.
const compilationService = {} as unknown as WorkflowCompilationService;

const definition = {
  workflowId: 'manual-review',
  workflowVersion: 1,
  name: 'Manual Review',
  initialStep: 'awaiting_manual_review',
  steps: [],
};

const createRegistry = () => {
  const workflow = { describeDefinition: jest.fn().mockReturnValue(definition) };

  return {
    workflow,
    registry: {
      getById: jest.fn().mockResolvedValue(workflow),
    } as unknown as WorkflowRegistryService,
  };
};

const createFailingRegistry = (cause: Error): WorkflowRegistryService =>
  ({ getById: jest.fn().mockRejectedValue(cause) }) as unknown as WorkflowRegistryService;

describe('WorkflowsController', () => {
  it('answers with the registry projection of the latest published workflow', async () => {
    const { registry, workflow } = createRegistry();

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', {}),
    ).resolves.toBe(definition);
    expect(registry.getById).toHaveBeenCalledWith('manual-review', undefined);
    expect(workflow.describeDefinition).toHaveBeenCalledTimes(1);
  });

  it('pins the lookup to the requested version', async () => {
    const { registry } = createRegistry();

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', { version: 2 }),
    ).resolves.toBe(definition);
    expect(registry.getById).toHaveBeenCalledWith('manual-review', 2);
  });

  it('reports a version the registry does not hold as a miss rather than a server fault', async () => {
    const registry = createFailingRegistry(new WorkflowRevisionNotFoundError('manual-review', 2));

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', { version: 2 }),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('keeps a malformed stored definition a server fault', async () => {
    const cause = new WorkflowInvalidError('INVALID_SHAPE');
    const registry = createFailingRegistry(cause);

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', { version: 1 }),
    ).rejects.toBe(cause);
  });

  it('lets an unknown workflow surface as the registry own not-found', async () => {
    const registry = createFailingRegistry(new WorkflowNotFoundException());

    await expect(
      new WorkflowsController(registry, compilationService).get('nope', {}),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('lets a retired revision surface as the registry own gone', async () => {
    const registry = createFailingRegistry(new WorkflowRetiredException());

    await expect(
      new WorkflowsController(registry, compilationService).get('discontinued', { version: 1 }),
    ).rejects.toThrow(WorkflowRetiredException);
  });
});
