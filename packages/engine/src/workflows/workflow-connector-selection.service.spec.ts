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
import { WorkflowRetiredException } from './errors/workflow-retired.exception';
import { WorkflowStepNotFoundException } from './errors/workflow-step-not-found.exception';
import { WorkflowVersionNotPublishedException } from './errors/workflow-version-not-published.exception';
import {
  WorkflowConnectorSelectionService,
  type ConnectorSelectionTarget,
} from './workflow-connector-selection.service';
import type { WorkflowConnectorSelectionsRepository } from './workflow-connector-selections.repository';
import type { WorkflowRegistryService } from './workflow-registry.service';
import type { WorkflowsRepository } from './workflows.repository';

const KEY = 'selection-spec';
const WORKFLOW_ID = '01912345-6789-7abc-8def-0123456789aa';
const STEP = 'verify';
const ACTOR = 'operator-oid';
const ALL: ConnectorSelectionTarget = { scope: 'all' };
const onVersion = (version: number): ConnectorSelectionTarget => ({ scope: 'version', version });

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
    findForStep: jest.fn().mockResolvedValue([]),
    upsert: jest.fn().mockResolvedValue(undefined),
    delete: jest.fn().mockResolvedValue(0),
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
    describeForAdmin: jest.fn(async (_key: string, version: number) => {
      const stored = revisions.find((candidate) => candidate.version === version);
      const rules = new ConnectorSelectionRules(port, ACTIVE_SCOPES);
      const definition = validateAndNormalizeWorkflow(stored.definition);
      const slot = definition.stepsByName[STEP].connectors[0];
      const chosen = selectionsRepository.upsert.mock.calls.find(
        ([, , calledVersion]) => calledVersion === version,
      )?.[4];

      return {
        steps: [
          {
            name: STEP,
            connectors: [
              {
                id: chosen ?? slot.id,
                authoredId: slot.id,
                selected: chosen !== undefined,
                selectableIds: rules.listSelectableIds(
                  definition.stepsByName[STEP],
                  slot.id,
                  chosen ?? slot.id,
                ),
              },
            ],
          },
        ],
      };
    }),
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

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );
    });

    it('reports a missing version as not found', async () => {
      const { sut, selectionsRepository } = createSut([revision(1, kycSlot())]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', onVersion(9), ACTOR)).rejects.toThrow(
        WorkflowNotFoundException,
      );
      expect(selectionsRepository.upsert).not.toHaveBeenCalled();
    });

    it('refuses a draft version as not published', async () => {
      const { sut } = createSut([revision(1, kycSlot(), 'draft')]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), ACTOR)).rejects.toThrow(
        WorkflowVersionNotPublishedException,
      );
    });

    it('refuses a retired version as gone', async () => {
      const { sut } = createSut([revision(1, kycSlot(), 'retired')]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), ACTOR)).rejects.toThrow(
        WorkflowRetiredException,
      );
    });

    it('reports a step the targeted version lacks', async () => {
      const { sut, selectionsRepository } = createSut([revision(1, kycSlot())]);

      const failure = sut.select(KEY, 'unknown_step', 'mock_kyc_2', onVersion(1), ACTOR);

      await expect(failure).rejects.toThrow(WorkflowStepNotFoundException);
      await expect(failure).rejects.toMatchObject({
        response: { code: 'WORKFLOW_STEP_NOT_FOUND', stepName: 'unknown_step' },
      });
      expect(selectionsRepository.upsert).not.toHaveBeenCalled();
    });

    it('reports a step no non-retired published version declares for all', async () => {
      const { sut } = createSut([
        revision(1, kycSlot(), 'retired'),
        revision(2, kycSlot(), 'draft'),
      ]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR)).rejects.toThrow(
        WorkflowStepNotFoundException,
      );
    });

    it.each([
      ['no_connector', document(1, []), 'mock_kyc_2'],
      ['fixture_not_allowed', kycSlot(), 'hidden_kyc'],
      ['type_mismatch', kycSlot(), 'mock_email_delivery'],
    ])(
      "answers the rules' %s refusal as the exception naming the version that refused",
      async (reason, definition, id) => {
        const { sut, selectionsRepository, auditService } = createSut([revision(1, definition)]);

        await expect(
          refusal(sut.select(KEY, STEP, id, onVersion(1), ACTOR)),
        ).resolves.toMatchObject({
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

      await expect(
        refusal(sut.select(KEY, STEP, 'kyc_with_fields', onVersion(1), ACTOR)),
      ).resolves.toMatchObject({
        reason: 'callback_fields_missing',
        detail: expect.stringContaining('kycOutcome'),
      });
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

      await expect(
        sut.select(KEY, STEP, 'kyc_with_fields', onVersion(1), ACTOR),
      ).resolves.toMatchObject({ id: 'kyc_with_fields' });
    });

    it('wraps the adapter declaration refusal as declaration_invalid with its message', async () => {
      const { sut, port } = createSut([revision(1, kycSlot())]);
      port.validateDeclarations.mockImplementation(() => {
        throw new Error('config.levelName is required');
      });

      await expect(
        refusal(sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), ACTOR)),
      ).resolves.toMatchObject({
        reason: 'declaration_invalid',
        detail: 'config.levelName is required',
      });
      expect(port.validateDeclarations).toHaveBeenCalledWith([
        expect.objectContaining({ id: 'mock_kyc_2', type: 'kyc' }),
      ]);
    });

    it('binds one version only for the version scope, leaving the others untouched', async () => {
      const { sut, selectionsRepository } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
      ]);

      await sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), ACTOR);

      expect(selectionsRepository.upsert).toHaveBeenCalledTimes(1);
      expect(selectionsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        1,
        STEP,
        'mock_kyc_2',
        ACTOR,
      );
    });

    it('skips drafts, retired and multi-connector versions for all', async () => {
      const { sut, selectionsRepository } = createSut([
        revision(1, kycSlot(), 'retired'),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
        revision(3, document(3, [connector('a', 'kyc'), connector('b', 'kyc', { order: 2 })])),
        revision(4, document(4, [connector('mock_kyc_1', 'kyc')])),
        revision(5, document(5, [connector('mock_email_delivery', 'email_delivery')]), 'draft'),
      ]);

      await sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR);

      expect(selectionsRepository.upsert.mock.calls.map(([, , version]) => version)).toEqual([
        2, 4,
      ]);
    });

    it('never validates a draft: one that would refuse does not block', async () => {
      const { sut, selectionsRepository } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_email_delivery', 'email_delivery')]), 'draft'),
      ]);

      await expect(sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR)).resolves.toMatchObject({
        id: 'mock_kyc_2',
      });
      expect(selectionsRepository.upsert).toHaveBeenCalledTimes(1);
    });

    it('answers multiple_connectors, naming the highest version, when no version qualifies', async () => {
      const multi = (version: number) =>
        document(version, [connector('a', 'kyc'), connector('b', 'kyc', { order: 2 })]);
      const { sut, selectionsRepository } = createSut([
        revision(1, multi(1)),
        revision(2, multi(2)),
      ]);

      await expect(refusal(sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR))).resolves.toMatchObject(
        {
          reason: 'multiple_connectors',
          workflowVersion: 2,
        },
      );
      expect(selectionsRepository.upsert).not.toHaveBeenCalled();
    });

    it('writes nothing when the second covered version refuses', async () => {
      const { sut, selectionsRepository, auditService } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_email_delivery', 'email_delivery')])),
      ]);

      await expect(refusal(sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR))).resolves.toMatchObject(
        {
          reason: 'type_mismatch',
          workflowVersion: 2,
        },
      );
      expect(selectionsRepository.upsert).not.toHaveBeenCalled();
      expect(auditService.logWorkflowChange).not.toHaveBeenCalled();
    });

    it('names the refusing revision by its stored number, not the version its document declares', async () => {
      const { sut } = createSut([
        revision(13, document(1, [connector('mock_email_delivery', 'email_delivery')])),
      ]);

      await expect(
        refusal(sut.select(KEY, STEP, 'mock_kyc_2', onVersion(13), ACTOR)),
      ).resolves.toMatchObject({ reason: 'type_mismatch', workflowVersion: 13 });
    });

    it('upserts one row per target under one lock and audits once with the previous connectors', async () => {
      const { sut, selectionsRepository, auditService, dataSource } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
        revision(3, document(3, [connector('mock_kyc_1', 'kyc')]), 'draft'),
      ]);
      selectionsRepository.findForStep.mockResolvedValue([
        { version: 2, connectorId: 'mock_kyc_1' } as never,
      ]);

      const projection = await sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR);

      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(selectionsRepository.lock).toHaveBeenCalledTimes(1);
      expect(selectionsRepository.lock).toHaveBeenCalledWith(expect.anything(), WORKFLOW_ID, STEP);
      expect(selectionsRepository.findForStep).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        STEP,
        [1, 2],
      );
      expect(selectionsRepository.upsert).toHaveBeenCalledTimes(2);
      expect(selectionsRepository.upsert).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        2,
        STEP,
        'mock_kyc_2',
        ACTOR,
      );
      expect(auditService.logWorkflowChange).toHaveBeenCalledTimes(1);
      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(dataSource, {
        action: 'workflow.connector_selected',
        actorId: ACTOR,
        resourceId: KEY,
        metadata: {
          workflowId: KEY,
          stepName: STEP,
          connectorId: 'mock_kyc_2',
          scope: 'all',
          versions: [
            { version: 1, previousConnectorId: null },
            { version: 2, previousConnectorId: 'mock_kyc_1' },
          ],
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

    it('projects the target version for the version scope and the highest covered one for all', async () => {
      const revisions = [
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
      ];
      const first = createSut(revisions);
      const second = createSut(revisions);

      await first.sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), ACTOR);
      await second.sut.select(KEY, STEP, 'mock_kyc_2', ALL, ACTOR);

      expect(first.registry.describeForAdmin).toHaveBeenCalledWith(KEY, 1);
      expect(second.registry.describeForAdmin).toHaveBeenCalledWith(KEY, 2);
    });

    it('audits a first selection with no previous connector', async () => {
      const { sut, auditService } = createSut([revision(1, kycSlot())]);

      await sut.select(KEY, STEP, 'mock_kyc_2', onVersion(1), null);

      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          actorId: 'unknown',
          metadata: expect.objectContaining({
            scope: 'version',
            versions: [{ version: 1, previousConnectorId: null }],
          }),
        }),
      );
    });
  });

  describe('clear', () => {
    it('reports an unknown family as not found', async () => {
      const { sut } = createSut([]);

      await expect(sut.clear(KEY, STEP, ALL, ACTOR)).rejects.toThrow(WorkflowNotFoundException);
    });

    it.each([
      ['a missing version', [revision(1, kycSlot())], onVersion(9), WorkflowNotFoundException],
      [
        'a draft version',
        [revision(1, kycSlot(), 'draft')],
        onVersion(1),
        WorkflowVersionNotPublishedException,
      ],
      [
        'a retired version',
        [revision(1, kycSlot(), 'retired')],
        onVersion(1),
        WorkflowRetiredException,
      ],
    ])('refuses %s', async (_label, revisions, target, exception) => {
      const { sut, selectionsRepository } = createSut(revisions);

      await expect(sut.clear(KEY, STEP, target, ACTOR)).rejects.toThrow(exception);
      expect(selectionsRepository.delete).not.toHaveBeenCalled();
    });

    it('reports a step the targeted version lacks', async () => {
      const { sut } = createSut([revision(1, kycSlot())]);

      await expect(sut.clear(KEY, 'any_step', onVersion(1), ACTOR)).rejects.toThrow(
        WorkflowStepNotFoundException,
      );
    });

    it('drops one version under the lock and audits it with the connector it replaced', async () => {
      const { sut, selectionsRepository, auditService, dataSource } = createSut([
        revision(1, kycSlot()),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
      ]);
      selectionsRepository.findForStep.mockResolvedValue([
        { version: 1, connectorId: 'mock_kyc_2' } as never,
      ]);

      await sut.clear(KEY, STEP, onVersion(1), ACTOR);

      expect(selectionsRepository.lock).toHaveBeenCalledWith(expect.anything(), WORKFLOW_ID, STEP);
      expect(selectionsRepository.delete).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        STEP,
        [1],
      );
      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(dataSource, {
        action: 'workflow.connector_selection_cleared',
        actorId: ACTOR,
        resourceId: KEY,
        metadata: {
          workflowId: KEY,
          stepName: STEP,
          connectorId: null,
          scope: 'version',
          versions: [{ version: 1, previousConnectorId: 'mock_kyc_2' }],
        },
      });
    });

    it('drops the covered set for all, keeping retired versions and skipping drafts', async () => {
      const { sut, selectionsRepository, auditService } = createSut([
        revision(1, kycSlot(), 'retired'),
        revision(2, document(2, [connector('mock_kyc_1', 'kyc')])),
        revision(3, document(3, [connector('mock_kyc_1', 'kyc')])),
        revision(4, document(4, [connector('mock_kyc_1', 'kyc')]), 'draft'),
      ]);

      await sut.clear(KEY, STEP, ALL, ACTOR);

      expect(selectionsRepository.delete).toHaveBeenCalledWith(
        expect.anything(),
        WORKFLOW_ID,
        STEP,
        [2, 3],
      );
      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({
            scope: 'all',
            versions: [
              { version: 2, previousConnectorId: null },
              { version: 3, previousConnectorId: null },
            ],
          }),
        }),
      );
    });

    it('audits a clear that found nothing to drop', async () => {
      const { sut, auditService } = createSut([revision(1, kycSlot())]);

      await sut.clear(KEY, STEP, onVersion(1), ACTOR);

      expect(auditService.logWorkflowChange).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          metadata: expect.objectContaining({
            versions: [{ version: 1, previousConnectorId: null }],
          }),
        }),
      );
    });
  });
});
