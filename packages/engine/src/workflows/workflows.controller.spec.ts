import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import type { AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowsController } from './workflows.controller';
import type { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowConnectorSelectionService } from './workflow-connector-selection.service';
import type { WorkflowRegistryService } from './workflow-registry.service';

// The read routes under test never reach the compiler, so it needs no behaviour here.
const compilationService = {} as unknown as WorkflowCompilationService;

// Likewise the selection service: only the two write handlers reach it.
const selectionService = {} as unknown as WorkflowConnectorSelectionService;

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
      new WorkflowsController(registry, compilationService, selectionService).get(
        'manual-review',
        {},
      ),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review', undefined);
  });

  it('pins the lookup to the requested version', async () => {
    const { registry } = createRegistry();

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).get('manual-review', {
        version: 2,
      }),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review', 2);
  });

  it('reports a version the registry does not hold as a miss rather than a server fault', async () => {
    const registry = createFailingRegistry(new WorkflowRevisionNotFoundError('manual-review', 2));

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).get('manual-review', {
        version: 2,
      }),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('keeps a malformed stored definition a server fault', async () => {
    const cause = new WorkflowInvalidError('INVALID_SHAPE');
    const registry = createFailingRegistry(cause);

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).get('manual-review', {
        version: 1,
      }),
    ).rejects.toBe(cause);
  });

  it('lets an unknown workflow surface as the registry own not-found', async () => {
    const registry = createFailingRegistry(new WorkflowNotFoundException());

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).get('nope', {}),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('hands the workflow id to the registry and returns its version list', async () => {
    const versions = { items: [] };
    const registry = {
      listVersionsForAdmin: jest.fn().mockResolvedValue(versions),
    } as unknown as WorkflowRegistryService;

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).listVersions(
        'manual-review',
      ),
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

    await expect(
      new WorkflowsController(registry, compilationService, selectionService).list(query),
    ).resolves.toBe(envelope);
    expect(registry.listForAdmin).toHaveBeenCalledWith(query);
  });

  describe('connector selection', () => {
    const operatorRequest = {
      adminTokenClaims: { oid: 'operator-oid' },
    } as unknown as AdminAuthenticatedRequest;

    it('binds the slot on behalf of the operator the token identifies and returns the projection', async () => {
      const projection = { id: 'veriff_kyc' };
      const service = {
        select: jest.fn().mockResolvedValue(projection),
      } as unknown as WorkflowConnectorSelectionService;

      await expect(
        new WorkflowsController(
          {} as WorkflowRegistryService,
          compilationService,
          service,
        ).selectStepConnector(
          'eu-b2c',
          'submit_kyc',
          { connectorId: 'veriff_kyc' },
          operatorRequest,
        ),
      ).resolves.toBe(projection);
      expect(service.select).toHaveBeenCalledWith(
        'eu-b2c',
        'submit_kyc',
        'veriff_kyc',
        'operator-oid',
      );
    });

    it('falls back to the unknown actor when the request carries no token claims', async () => {
      const service = {
        select: jest.fn().mockResolvedValue({}),
      } as unknown as WorkflowConnectorSelectionService;

      await new WorkflowsController(
        {} as WorkflowRegistryService,
        compilationService,
        service,
      ).selectStepConnector(
        'eu-b2c',
        'submit_kyc',
        { connectorId: 'veriff_kyc' },
        {} as AdminAuthenticatedRequest,
      );

      expect(service.select).toHaveBeenCalledWith(
        'eu-b2c',
        'submit_kyc',
        'veriff_kyc',
        ADMIN_ACCESS_UNKNOWN_ACTOR,
      );
    });

    it('clears the binding on behalf of the operator and answers with nothing', async () => {
      const service = {
        clear: jest.fn().mockResolvedValue(undefined),
      } as unknown as WorkflowConnectorSelectionService;

      await expect(
        new WorkflowsController(
          {} as WorkflowRegistryService,
          compilationService,
          service,
        ).clearStepConnector('eu-b2c', 'submit_kyc', operatorRequest),
      ).resolves.toBeUndefined();
      expect(service.clear).toHaveBeenCalledWith('eu-b2c', 'submit_kyc', 'operator-oid');
    });
  });
});
