import { WorkflowInvalidError } from '@tsh/ddl-schema';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import type { AdminAuthenticatedRequest } from '../auth/azure-jwt.guard';
import type { ListAdminWorkflowsQueryDto } from './dto/list-admin-workflows.query.dto';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowRevisionNotFoundError } from './errors/workflow-revision-not-found.error';
import { WorkflowsController } from './workflows.controller';
import type { WorkflowCompilationService } from './workflow-compilation.service';
import type { WorkflowConnectorSelectionService } from './workflow-connector-selection.service';
import type { WorkflowDraftsService } from './workflow-drafts.service';
import type { WorkflowRegistryService } from './workflow-registry.service';

// The read routes under test never reach the compiler or the draft writes, so neither needs behaviour here.
const compilationService = {} as unknown as WorkflowCompilationService;
const draftsService = {} as unknown as WorkflowDraftsService;

const OPERATOR = 'operator-oid';

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
      new WorkflowsController(registry, compilationService, draftsService, selectionService).get(
        'manual-review',
      ),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review');
  });

  it('lets an unknown workflow surface as the registry own not-found', async () => {
    const registry = createFailingRegistry(new WorkflowNotFoundException());

    await expect(
      new WorkflowsController(registry, compilationService, draftsService, selectionService).get(
        'nope',
      ),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('pins the lookup to the requested version', async () => {
    const { registry } = createRegistry();

    await expect(
      new WorkflowsController(
        registry,
        compilationService,
        draftsService,
        selectionService,
      ).getVersion({
        workflowId: 'manual-review',
        version: 2,
      }),
    ).resolves.toBe(definition);
    expect(registry.describeForAdmin).toHaveBeenCalledWith('manual-review', 2);
  });

  it('reports a version the registry does not hold as a miss rather than a server fault', async () => {
    const registry = createFailingRegistry(new WorkflowRevisionNotFoundError('manual-review', 2));

    await expect(
      new WorkflowsController(
        registry,
        compilationService,
        draftsService,
        selectionService,
      ).getVersion({
        workflowId: 'manual-review',
        version: 2,
      }),
    ).rejects.toThrow(WorkflowNotFoundException);
  });

  it('keeps a malformed stored definition a server fault', async () => {
    const cause = new WorkflowInvalidError('INVALID_SHAPE');
    const registry = createFailingRegistry(cause);

    await expect(
      new WorkflowsController(
        registry,
        compilationService,
        draftsService,
        selectionService,
      ).getVersion({
        workflowId: 'manual-review',
        version: 1,
      }),
    ).rejects.toBe(cause);
  });

  it('hands the workflow id to the registry and returns its version list', async () => {
    const versions = { items: [] };
    const registry = {
      listVersionsForAdmin: jest.fn().mockResolvedValue(versions),
    } as unknown as WorkflowRegistryService;

    await expect(
      new WorkflowsController(
        registry,
        compilationService,
        draftsService,
        selectionService,
      ).listVersions('manual-review'),
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
      new WorkflowsController(registry, compilationService, draftsService, selectionService).list(
        query,
      ),
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
          draftsService,
          service,
        ).selectStepConnector(
          'eu-b2c',
          'submit_kyc',
          { connectorId: 'veriff_kyc', scope: 'version', version: 2 },
          operatorRequest,
        ),
      ).resolves.toBe(projection);
      expect(service.select).toHaveBeenCalledWith(
        'eu-b2c',
        'submit_kyc',
        'veriff_kyc',
        { scope: 'version', version: 2 },
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
        draftsService,
        service,
      ).selectStepConnector(
        'eu-b2c',
        'submit_kyc',
        { connectorId: 'veriff_kyc', scope: 'all' },
        {} as AdminAuthenticatedRequest,
      );

      expect(service.select).toHaveBeenCalledWith(
        'eu-b2c',
        'submit_kyc',
        'veriff_kyc',
        { scope: 'all', version: undefined },
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
          draftsService,
          service,
        ).clearStepConnector(
          'eu-b2c',
          'submit_kyc',
          { scope: 'version', version: 1 },
          operatorRequest,
        ),
      ).resolves.toBeUndefined();
      expect(service.clear).toHaveBeenCalledWith(
        'eu-b2c',
        'submit_kyc',
        { scope: 'version', version: 1 },
        'operator-oid',
      );
    });
  });

  describe('draft writes', () => {
    const createDraftController = () => {
      const service = {
        create: jest.fn().mockResolvedValue({ workflowId: 'flow' }),
        getDocument: jest.fn().mockResolvedValue({ workflowId: 'flow', document: {} }),
        update: jest.fn().mockResolvedValue({ workflowId: 'flow' }),
        remove: jest.fn().mockResolvedValue(undefined),
        publish: jest.fn().mockResolvedValue({ workflowId: 'flow', status: 'published' }),
      } as unknown as jest.Mocked<WorkflowDraftsService>;
      const request = {
        adminTokenClaims: { oid: OPERATOR },
      } as unknown as AdminAuthenticatedRequest;
      const { registry } = createRegistry();

      return {
        service,
        request,
        controller: new WorkflowsController(
          registry,
          compilationService,
          service,
          selectionService,
        ),
      };
    };

    it('hands the document and the operator to create', async () => {
      const { controller, service, request } = createDraftController();
      const document = { id: 'flow', version: 1 };

      await expect(controller.create(document, request)).resolves.toEqual({ workflowId: 'flow' });
      expect(service.create).toHaveBeenCalledWith(document, OPERATOR);
    });

    it('reads the document of the addressed version', async () => {
      const { controller, service } = createDraftController();

      await controller.getVersionDocument({ workflowId: 'flow', version: 2 });

      expect(service.getDocument).toHaveBeenCalledWith('flow', 2);
    });

    it('hands the address, the document and the operator to update', async () => {
      const { controller, service, request } = createDraftController();
      const document = { id: 'flow', version: 2 };

      await controller.update({ workflowId: 'flow', version: 1 }, document, request);

      expect(service.update).toHaveBeenCalledWith('flow', 1, document, OPERATOR);
    });

    it('hands the address and the operator to publish', async () => {
      const { controller, service, request } = createDraftController();

      await expect(
        controller.publish({ workflowId: 'flow', version: 2 }, request),
      ).resolves.toEqual({ workflowId: 'flow', status: 'published' });
      expect(service.publish).toHaveBeenCalledWith('flow', 2, OPERATOR);
    });

    it('hands the address and the operator to remove', async () => {
      const { controller, service, request } = createDraftController();

      await expect(
        controller.remove({ workflowId: 'flow', version: 1 }, request),
      ).resolves.toBeUndefined();
      expect(service.remove).toHaveBeenCalledWith('flow', 1, OPERATOR);
    });
  });
});
