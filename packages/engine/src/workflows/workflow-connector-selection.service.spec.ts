import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import type { DataSource, EntityManager } from 'typeorm';
import type { AuditService } from '../audit/audit.service';
import type {
  ConnectorAdapterSummary,
  ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorSelectionRules } from './domain/connector-selection';
import type { WorkflowVersionEntity } from './entity/workflow-version.entity';
import { WorkflowConnectorSelectionInvalidException } from './errors/workflow-connector-selection-invalid.exception';
import { WorkflowNotFoundException } from './errors/workflow-not-found.exception';
import { WorkflowStepNotFoundException } from './errors/workflow-step-not-found.exception';
import { WorkflowConnectorSelectionService } from './workflow-connector-selection.service';
import type { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
import type { WorkflowRegistryService } from './workflow-registry.service';
import type { WorkflowsRepository } from './workflows.repository';

const KEY = 'selection-spec';
const WORKFLOW_ID = '01912345-6789-7abc-8def-0123456789aa';
const STEP = 'verify';
const ACTOR = 'operator-oid';

const adapter = (
  id: string,
  type: ConnectorAdapterSummary['type'],
  overrides: Partial<ConnectorAdapterSummary> = {},
): ConnectorAdapterSummary => ({
  id,
  type,
  supportsAsyncCallback: false,
  scope: 'fixtures',
  callbackFields: [],
  ...overrides,
});

/** What the port registers; `hidden_kyc` sits in a scope the active ones below leave out. */
const ADAPTERS: readonly ConnectorAdapterSummary[] = [
  adapter('mock_kyc_1', 'kyc'),
  adapter('mock_kyc_2', 'kyc'),
  adapter('hidden_kyc', 'kyc', { scope: 'users' }),
  adapter('kyc_with_fields', 'kyc', { callbackFields: ['kycOutcome'] }),
  adapter('mock_email_delivery', 'email_delivery'),
  adapter('mock_async_callback', 'custom', { supportsAsyncCallback: true }),
  adapter('http_request', 'custom'),
];
const ACTIVE_SCOPES = ['built-in', 'fixtures'] as const;

type ConnectorDocument = Record<string, unknown>;

const connector = (
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
): ConnectorDocument => ({
  name: id,
  id,
  type,
  order: 1,
  fieldMapping: {},
  ...extra,
});

const document = (
  version: number,
  connectors: ConnectorDocument[],
  data: Record<string, unknown> = {},
) => ({
  id: KEY,
  version,
  initial: STEP,
  steps: [
    {
      name: STEP,
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data,
        connectors,
        transitions: [{ status: 'success', target: 'done' }],
      },
    },
    { name: 'done', type: 'custom', config: { status: 'approved', data: {}, transitions: [] } },
  ],
});

const revision = (
  version: number,
  definition: Record<string, unknown>,
  status = 'published',
): WorkflowVersionEntity =>
  ({
    workflowId: WORKFLOW_ID,
    version,
    status,
    definition,
    workflow: { name: 'Selection spec' },
  }) as unknown as WorkflowVersionEntity;

const kycSlot = () => document(1, [connector('mock_kyc_1', 'kyc')]);

const createSut = (revisions: WorkflowVersionEntity[]) => {
  const manager = {} as EntityManager;
  const dataSource = {
    manager,
    transaction: jest.fn(async (callback: (tx: EntityManager) => unknown) => callback(manager)),
  } as unknown as DataSource;
  const workflowsRepository = {
    findRevisions: jest.fn().mockResolvedValue(revisions),
  } as unknown as jest.Mocked<WorkflowsRepository>;
  const selectionsRepository = {
    lock: jest.fn().mockResolvedValue(undefined),
    find: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(true),
  } as unknown as jest.Mocked<WorkflowConnectorSelectionsRepository>;
  const port = {
    listAdapters: jest.fn().mockReturnValue(ADAPTERS),
    validateDeclarations: jest.fn(),
  } as unknown as jest.Mocked<ConnectorExecutionPort>;
  const registry = {
    getActiveScopes: jest.fn().mockReturnValue(ACTIVE_SCOPES),
    normalizeDefinition: jest.fn((definition: Record<string, unknown>) =>
      validateAndNormalizeWorkflow(definition),
    ),
    createConnectorSelectionRules: jest.fn(() => new ConnectorSelectionRules(port, ACTIVE_SCOPES)),
  } as unknown as jest.Mocked<WorkflowRegistryService>;
  const auditService = {
    logWorkflowChange: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<AuditService>;

  return {
    dataSource,
    workflowsRepository,
    selectionsRepository,
    registry,
    auditService,
    port,
    sut: new WorkflowConnectorSelectionService(
      dataSource,
      workflowsRepository,
      selectionsRepository,
      registry,
      auditService,
    ),
  };
};

const refusal = async (promise: Promise<unknown>): Promise<Record<string, unknown>> => {
  const error: unknown = await promise.then(
    () => undefined,
    (cause: unknown) => cause,
  );

  expect(error).toBeInstanceOf(WorkflowConnectorSelectionInvalidException);

  return (error as WorkflowConnectorSelectionInvalidException).getResponse() as Record<
    string,
    unknown
  >;
};

describe('WorkflowConnectorSelectionService', () => {
  describe('select', () => {
    it('reports an unknown family as not found', async () => {
      const { sut } = createSut([]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', ACTOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );
    });

    it('reports a step no non-retired version declares', async () => {
      const { sut, selectionsRepository } = createSut([
        revision(1, kycSlot()),
        revision(2, kycSlot(), 'retired'),
      ]);

      const failure = sut.select(KEY, 'unknown_step', 'mock_kyc_2', ACTOR);

      await expect(failure).rejects.toThrow(WorkflowStepNotFoundException);
      await expect(failure).rejects.toMatchObject({
        response: { code: 'WORKFLOW_STEP_NOT_FOUND', stepName: 'unknown_step' },
      });
      expect(selectionsRepository.upsert).not.toHaveBeenCalled();
    });

    it.each([
      ['no_connector', document(1, []), 'mock_kyc_2'],
      ['fixture_not_allowed', kycSlot(), 'hidden_kyc'],
      ['type_mismatch', kycSlot(), 'mock_email_delivery'],
    ])(
      "answers the rules' %s refusal as the exception naming the version that refused",
      async (reason, definition, id) => {
        const { sut, selectionsRepository, auditService } = createSut([revision(1, definition)]);

        await expect(refusal(sut.select(KEY, STEP, id, ACTOR))).resolves.toMatchObject({
          code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
          stepName: STEP,
          connectorId: id,
          workflowVersion: 1,
          reason,
        });
        expect(selectionsRepository.upsert).not.toHaveBeenCalled();
        expect(auditService.logWorkflowChange).not.toHaveBeenCalled();
      },
    );

    it("carries the rules' detail, such as the missing callback field", async () => {
      const { sut } = createSut([revision(1, kycSlot())]);

      await expect(refusal(sut.select(KEY, STEP, 'kyc_with_fields', ACTOR))).resolves.toMatchObject(
        { reason: 'callback_fields_missing', detail: expect.stringContaining('kycOutcome') },
      );
    });

    it('accepts an adapter whose callback fields the step declares', async () => {
      const { sut } = createSut([
        revision(
          1,
          document(1, [connector('mock_kyc_1', 'kyc')], {
            kycOutcome: { type: 'text', required: false },
          }),
        ),
      ]);

      await expect(sut.select(KEY, STEP, 'kyc_with_fields', ACTOR)).resolves.toMatchObject({
        id: 'kyc_with_fields',
      });
    });

    it('wraps the adapter declaration refusal as declaration_invalid with its message', async () => {
      const { sut, port } = createSut([revision(1, kycSlot())]);
      port.validateDeclarations.mockImplementation(() => {
        throw new Error('config.levelName is required');
      });

      await expect(refusal(sut.select(KEY, STEP, 'mock_kyc_2', ACTOR))).resolves.toMatchObject({
        reason: 'declaration_invalid',
        detail: 'config.levelName is required',
      });
      expect(port.validateDeclarations).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'mock_kyc_2', type: 'kyc' }),
      ]);
    });

    it('lets the first version that refuses end the request, ignoring retired ones', async () => {
      const { sut } = createSut([
        revision(1, document(1, [connector('mock_email_delivery', 'email_delivery')]), 'retired'),
        revision(2, kycSlot()),
        revision(3, document(3, [connector('mock_email_delivery', 'email_delivery')])),
      ]);

      await expect(refusal(sut.select(KEY, STEP, 'mock_kyc_2', ACTOR))).resolves.toMatchObject({
        reason: 'type_mismatch',
        workflowVersion: 3,
      });
    });

    it('stores the choice under the lock, audits after commit and projects the published slot', async () => {
      const { sut, selectionsRepository, auditService, dataSource } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
        revision(3, document(3, [connector('mock_kyc_1', 'kyc')]), 'draft'),
      ]);
      selectionsRepository.find.mockResolvedValue({
        connectorId: 'mock_kyc_1',
      } as never);

      const projection = await sut.select(KEY, STEP, 'mock_kyc_2', ACTOR);

      expect(selectionsRepository.lock).toHaveBeenCalledWith(expect.anything(), WORKFLOW_ID, STEP);
      expect(selectionsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        STEP,
        'mock_kyc_2',
        ACTOR,
      );
      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(dataSource, {
        action: 'workflow.connector_selected',
        actorId: ACTOR,
        resourceId: KEY,
        metadata: {
          workflowId: KEY,
          stepName: STEP,
          previousConnectorId: 'mock_kyc_1',
          connectorId: 'mock_kyc_2',
        },
      });
      // `kyc_with_fields` is not offered: the step lacks `kycOutcome`, so a save would refuse it.
      expect(projection).toMatchObject({
        id: 'mock_kyc_2',
        authoredId: 'mock_kyc_1',
        selected: true,
        selectableIds: ['mock_kyc_1', 'mock_kyc_2'],
      });
    });

    it('audits a first selection with no previous connector', async () => {
      const { sut, auditService } = createSut([revision(1, kycSlot())]);

      await sut.select(KEY, STEP, 'mock_kyc_2', null);

      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: 'unknown',
          metadata: expect.objectContaining({ previousConnectorId: null }),
        }),
      );
    });
  });

  describe('clear', () => {
    it('reports an unknown family as not found', async () => {
      const { sut } = createSut([]);

      await expect(sut.clear(KEY, STEP, ACTOR)).rejects.toThrow(WorkflowNotFoundException);
    });

    it('drops the stored choice and audits it with the connector it replaced', async () => {
      const { sut, selectionsRepository, auditService, dataSource } = createSut([
        revision(1, kycSlot()),
      ]);
      selectionsRepository.find.mockResolvedValue({ connectorId: 'mock_kyc_2' } as never);

      await sut.clear(KEY, STEP, ACTOR);

      expect(selectionsRepository.lock).toHaveBeenCalledWith(expect.anything(), WORKFLOW_ID, STEP);
      expect(selectionsRepository.delete).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        STEP,
      );
      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(dataSource, {
        action: 'workflow.connector_selection_cleared',
        actorId: ACTOR,
        resourceId: KEY,
        metadata: {
          workflowId: KEY,
          stepName: STEP,
          previousConnectorId: 'mock_kyc_2',
          connectorId: null,
        },
      });
    });

    it('audits a clear that found nothing to drop', async () => {
      const { sut, auditService } = createSut([revision(1, kycSlot())]);

      await sut.clear(KEY, 'any_step', ACTOR);

      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({ stepName: 'any_step', previousConnectorId: null }),
        }),
      );
    });
  });
});
