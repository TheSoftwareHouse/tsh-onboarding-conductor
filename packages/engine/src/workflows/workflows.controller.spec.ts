import { WorkflowInvalidError } from '@tsh/ddl-schema';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
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
  return {
    registry: {
      describeForAdmin: jest.fn().mockResolvedValue(definition),
    } as unknown as WorkflowRegistryService,
  };
};

const createFailingRegistry = (cause: Error): WorkflowRegistryService =>
  ({ describeForAdmin: jest.fn().mockRejectedValue(cause) }) as unknown as WorkflowRegistryService;

describe('WorkflowsController', () => {
  it('answers with the registry projection of the latest published workflow', async () => {
    const { registry } = createRegistry();

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', {}),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review', undefined);
  });

  it('pins the lookup to the requested version', async () => {
    const { registry } = createRegistry();

    await expect(
      new WorkflowsController(registry, compilationService).get('manual-review', { version: 2 }),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review', 2);
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

  it('hands the workflow id to the registry and returns its version list', async () => {
    const versions = { items: [] };
    const registry = {
      listVersionsForAdmin: jest.fn().mockResolvedValue(versions),
    } as unknown as WorkflowRegistryService;

    await expect(
      new WorkflowsController(registry, compilationService).listVersions('manual-review'),
    ).resolves.toBe(versions);
    expect(registry.listVersionsForAdmin).toHaveBeenCalledWith('manual-review');
  });

  it('hands the query straight to the registry and returns its envelope', async () => {
    const envelope = {
      items: [],
      meta: { pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    };
    const registry = {
      listForAdmin: jest.fn().mockResolvedValue(envelope),
    } as unknown as WorkflowRegistryService;
    const query = { page: 1, limit: 20 } as ListAdminWorkflowsQueryDto;

    await expect(new WorkflowsController(registry, compilationService).list(query)).resolves.toBe(
      envelope,
    );
    expect(registry.listForAdmin).toHaveBeenCalledWith(query);
  });
});
