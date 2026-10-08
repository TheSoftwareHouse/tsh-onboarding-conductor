import 'reflect-metadata';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import {
  MockAsyncCallback2Connector,
  MockAsyncCallbackConnector,
} from '../src/connectors/adapters/fixtures/mock-async-callback.connector';
import {
  MockKyc1Connector,
  MockKyc2Connector,
} from '../src/connectors/adapters/fixtures/mock-kyc.connector';
import { AwaitingCallbackConnectorResolver } from '../src/connectors/resolvers/awaiting-callback-connector.resolver';
import { ConnectorExecutionResult } from '../src/connectors/ports/connector-execution-result';
import { exceptionFactory } from '../src/validation/validation-exception.factory';
import { startE2eServer } from './e2e-server';

const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const AUDIENCE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_ID = 'admin-workflow-connector-selection-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-0000000000ee';

const SYNC_WORKFLOW_ID = 'connector-selection-e2e-sync';
const REFUSALS_WORKFLOW_ID = 'connector-selection-e2e-refusals';
const ASYNC_WORKFLOW_ID = 'connector-selection-e2e-async';
const WORKFLOW_IDS = [SYNC_WORKFLOW_ID, REFUSALS_WORKFLOW_ID, ASYNC_WORKFLOW_ID];
const UNKNOWN_WORKFLOW_ID = 'connector-selection-e2e-unknown';

const ASYNC_PROVIDER_ID = 'mock_async_callback';
const ASYNC_PROVIDER_2_ID = 'mock_async_callback_2';
const WEBHOOK_ROUTE_PREFIX = '/v1/webhooks/';

const doneStep = {
  name: 'done',
  type: 'custom',
  config: { status: 'approved', data: {}, transitions: [] },
};

const emailField = {
  email: { type: 'text', required: true, validation: { format: 'email' } },
};

/** The fields a KYC callback may carry, declared the way a typed KYC step declares them. */
const kycCallbackFields = {
  kycOutcome: { type: 'text', required: false },
  kycRetryStep: { type: 'text', required: false },
  kycReasonCodes: { type: 'array', required: false, items: { type: 'text' } },
  kycCustomerMessage: { type: 'text', required: false },
};

const customStep = (
  name: string,
  target: string,
  data: Record<string, unknown>,
  connectors: Array<Record<string, unknown>>,
) => ({
  name,
  type: 'custom',
  config: {
    status: 'awaiting_user',
    data,
    connectors,
    transitions: [{ status: 'success', target }],
  },
});

const mockKycSlot = (extra: Record<string, unknown> = {}) => ({
  name: 'mock_kyc_1',
  id: 'mock_kyc_1',
  type: 'kyc',
  order: 1,
  fieldMapping: { email: 'email' },
  ...extra,
});

const asyncSlot = () => ({
  name: ASYNC_PROVIDER_ID,
  id: ASYNC_PROVIDER_ID,
  type: 'custom',
  order: 1,
  async: true,
  fieldMapping: {},
});

const syncWorkflow = {
  id: SYNC_WORKFLOW_ID,
  version: 1,
  initial: 'verify',
  steps: [customStep('verify', 'done', emailField, [mockKycSlot()]), doneStep],
};

const refusalsWorkflow = {
  id: REFUSALS_WORKFLOW_ID,
  version: 1,
  initial: 'kyc_step',
  steps: [
    customStep('kyc_step', 'sumsub_step', emailField, [
      mockKycSlot({
        errorHandler: 'retry_then_fallback',
        fallback: [{ name: 'backup_kyc', id: 'mock_kyc_2', type: 'kyc' }],
      }),
    ]),
    customStep('sumsub_step', 'async_step', kycCallbackFields, [mockKycSlot()]),
    customStep('async_step', 'two_slots', {}, [asyncSlot()]),
    customStep('two_slots', 'done', {}, [
      mockKycSlot(),
      mockKycSlot({ name: 'mock_kyc_2', id: 'mock_kyc_2', order: 2 }),
    ]),
    doneStep,
  ],
};

/**
 * What the registered adapters leave for a `kyc` slot whose step declares no callback field: the
 * two mocks and the file-upload double; `sumsub_kyc` and `veriff_kyc` report fields the step lacks.
 */
const SELECTABLE_FOR_PLAIN_KYC_SLOT = ['mock_kyc_1', 'mock_kyc_2', 'mock_sumsub_file_upload'];

const asyncWorkflow = {
  id: ASYNC_WORKFLOW_ID,
  version: 1,
  initial: 'await_provider',
  steps: [customStep('await_provider', 'done', {}, [asyncSlot()]), doneStep],
};

const writeWorkflows = (directory: string) => {
  for (const document of [syncWorkflow, refusalsWorkflow, asyncWorkflow]) {
    writeFileSync(path.join(directory, `${document.id}.workflow.json`), JSON.stringify(document));
  }
};

type ProjectedConnector = {
  id: string;
  authoredId: string;
  selected: boolean;
  selectableIds: string[];
};

type AuditRow = {
  actor_type: string;
  actor_id: string;
  action: string;
  entry_type: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
};

type PendingConnectorRow = { pending_connector: Record<string, unknown> | null };

describe('Admin workflow connector selection (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let workflowsDir: string;
  let token: string;

  const createdOnboardingIds = new Set<string>();

  const http = () => request(app.getHttpServer());

  const selectConnector = (workflowId: string, stepName: string, body: Record<string, unknown>) =>
    http()
      .put(`/v1/admin/workflows/${workflowId}/steps/${stepName}/connector`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  const clearConnector = (workflowId: string, stepName: string) =>
    http()
      .delete(`/v1/admin/workflows/${workflowId}/steps/${stepName}/connector`)
      .set('Authorization', `Bearer ${token}`);

  const getDefinition = (workflowId: string) =>
    http().get(`/v1/admin/workflows/${workflowId}`).set('Authorization', `Bearer ${token}`);

  const readSlot = async (workflowId: string, stepName: string): Promise<ProjectedConnector> => {
    const response = await getDefinition(workflowId).expect(200);
    const step = (
      response.body.steps as Array<{ name: string; connectors: ProjectedConnector[] }>
    ).find((candidate) => candidate.name === stepName);

    if (!step) {
      throw new Error(`step ${stepName} missing from ${workflowId}`);
    }

    return step.connectors[0];
  };

  const startOnboarding = async (workflowId: string): Promise<string> => {
    const response = await http().post('/v1/onboardings').send({ workflowId }).expect(201);
    const onboardingId = response.body.onboardingId as string;

    createdOnboardingIds.add(onboardingId);

    return onboardingId;
  };

  const readAuditRows = (workflowId: string): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT actor_type, actor_id, action, entry_type, resource_type, resource_id, metadata
         FROM audit_log
        WHERE resource_type = 'workflow' AND resource_id = $1
        ORDER BY occurred_at, id`,
      [workflowId],
    );

  const readPendingConnector = async (
    onboardingId: string,
  ): Promise<Record<string, unknown> | null> => {
    const rows: PendingConnectorRow[] = await dataSource.query(
      'SELECT pending_connector FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return rows[0].pending_connector;
  };

  const readOnboardingStatus = async (onboardingId: string): Promise<string> => {
    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return rows[0].status;
  };

  const deleteWorkflowAuditRows = () =>
    dataSource.query(
      "DELETE FROM audit_log WHERE resource_type = 'workflow' AND resource_id = ANY($1::text[])",
      [WORKFLOW_IDS],
    );

  const postCallback = (providerId: string, rawBody: Uint8Array) =>
    http()
      .post(`${WEBHOOK_ROUTE_PREFIX}${providerId}/callback`)
      .set('content-type', 'application/json')
      .send(Buffer.from(rawBody).toString('utf8'));

  beforeAll(async () => {
    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-connector-selection-workflows-'));
    writeWorkflows(workflowsDir);

    const keyPair = await generateKeyPair('RS256', { extractable: true });
    const privateKey: KeyLike = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    const getKey = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });

    process.env.ADMIN_AUTH_ENABLED = 'true';
    process.env.AZURE_TENANT_ID = TENANT_ID;
    process.env.AZURE_API_AUDIENCE = AUDIENCE;
    process.env.ADMIN_REQUIRED_ROLES = 'admin';
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;

    const { AppModule } = await import('../src/app.module');
    const { ADMIN_TOKEN_VERIFIER } = await import('../src/auth/admin-token-verifier.port');
    const { AzureTokenVerifier, buildEntraIssuer } =
      await import('../src/auth/azure-token-verifier');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ADMIN_TOKEN_VERIFIER)
      .useValue(new AzureTokenVerifier({ tenantId: TENANT_ID, audience: AUDIENCE, getKey }))
      .compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    // What `createApp` configures, minus the parts these routes do not need: provider callbacks
    // arrive as raw bytes, everything else as JSON, and bodies are validated by their DTOs.
    const isCallback = (req: { originalUrl?: string; url?: string }): boolean =>
      (req.originalUrl ?? req.url ?? '').split('?')[0].startsWith(WEBHOOK_ROUTE_PREFIX);
    app.useBodyParser('raw', { type: (req) => isCallback(req) });
    app.useBodyParser('json', { strict: false, type: (req) => !isCallback(req) });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, exceptionFactory }));
    await startE2eServer(app);
    dataSource = app.get(DataSource);
    await deleteWorkflowAuditRows();

    token = await new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OBJECT_ID,
      preferred_username: 'connector.selection@tsh.io',
      tid: TENANT_ID,
      roles: ['admin'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject('operator-subject')
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('30m')
      .sign(privateKey);
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      const onboardingIds = Array.from(createdOnboardingIds);

      if (onboardingIds.length > 0) {
        await dataSource.query(
          'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
          [onboardingIds],
        );
        await dataSource.query('DELETE FROM audit_log WHERE resource_id = ANY($1::text[])', [
          onboardingIds,
        ]);
        await dataSource.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          onboardingIds,
        ]);
      }

      // Startup published these throwaway families into the shared table; their selections go
      // with them through the foreign key's cascade.
      await dataSource.query('DELETE FROM workflows WHERE key = ANY($1::text[])', [WORKFLOW_IDS]);
      await deleteWorkflowAuditRows();
    }

    await app?.close();

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  describe('a synchronous slot', () => {
    it('binds the slot to another adapter, runs it, and reverts when cleared', async () => {
      const authored = await readSlot(SYNC_WORKFLOW_ID, 'verify');
      expect(authored).toMatchObject({
        id: 'mock_kyc_1',
        authoredId: 'mock_kyc_1',
        selected: false,
      });

      const selected = await selectConnector(SYNC_WORKFLOW_ID, 'verify', {
        connectorId: 'mock_kyc_2',
      }).expect(200);

      expect(selected.body).toMatchObject({
        id: 'mock_kyc_2',
        authoredId: 'mock_kyc_1',
        selected: true,
      });
      expect(selected.body.selectableIds).toEqual(SELECTABLE_FOR_PLAIN_KYC_SLOT);
      await expect(readSlot(SYNC_WORKFLOW_ID, 'verify')).resolves.toMatchObject({
        id: 'mock_kyc_2',
        authoredId: 'mock_kyc_1',
        selected: true,
        selectableIds: SELECTABLE_FOR_PLAIN_KYC_SLOT,
      });

      const onboardingId = await startOnboarding(SYNC_WORKFLOW_ID);
      const kyc1Execute = jest
        .spyOn(app.get(MockKyc1Connector), 'execute')
        .mockResolvedValue(ConnectorExecutionResult.accepted());
      const kyc2Execute = jest
        .spyOn(app.get(MockKyc2Connector), 'execute')
        .mockResolvedValue(ConnectorExecutionResult.accepted());

      await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'person@example.com' })
        .expect(201);

      expect(kyc2Execute).toHaveBeenCalledTimes(1);
      expect(kyc1Execute).not.toHaveBeenCalled();
      await expect(readAuditRows(SYNC_WORKFLOW_ID)).resolves.toEqual([
        {
          actor_type: 'operator',
          actor_id: OPERATOR_OBJECT_ID,
          action: 'workflow.connector_selected',
          entry_type: 'success',
          resource_type: 'workflow',
          resource_id: SYNC_WORKFLOW_ID,
          metadata: {
            workflowId: SYNC_WORKFLOW_ID,
            stepName: 'verify',
            previousConnectorId: null,
            connectorId: 'mock_kyc_2',
          },
        },
      ]);

      await clearConnector(SYNC_WORKFLOW_ID, 'verify').expect(204);

      await expect(readSlot(SYNC_WORKFLOW_ID, 'verify')).resolves.toMatchObject({
        id: 'mock_kyc_1',
        authoredId: 'mock_kyc_1',
        selected: false,
      });
      const rows = await readAuditRows(SYNC_WORKFLOW_ID);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toMatchObject({
        actor_type: 'operator',
        actor_id: OPERATOR_OBJECT_ID,
        action: 'workflow.connector_selection_cleared',
        resource_type: 'workflow',
        resource_id: SYNC_WORKFLOW_ID,
        metadata: {
          workflowId: SYNC_WORKFLOW_ID,
          stepName: 'verify',
          previousConnectorId: 'mock_kyc_2',
          connectorId: null,
        },
      });
    });
  });

  describe('refusals', () => {
    it('answers 404 for an unknown family and for a step no version declares', async () => {
      const unknownFamily = await selectConnector(UNKNOWN_WORKFLOW_ID, 'verify', {
        connectorId: 'mock_kyc_2',
      }).expect(404);
      expect(unknownFamily.body).toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });

      const unknownStep = await selectConnector(SYNC_WORKFLOW_ID, 'no_such_step', {
        connectorId: 'mock_kyc_2',
      }).expect(404);
      expect(unknownStep.body).toMatchObject({
        code: 'WORKFLOW_STEP_NOT_FOUND',
        stepName: 'no_such_step',
      });

      const clearUnknownFamily = await clearConnector(UNKNOWN_WORKFLOW_ID, 'verify').expect(404);
      expect(clearUnknownFamily.body).toMatchObject({ code: 'WORKFLOW_NOT_FOUND' });
    });

    it.each([
      ['type_mismatch', REFUSALS_WORKFLOW_ID, 'kyc_step', 'mock_email_delivery'],
      ['async_unsupported', REFUSALS_WORKFLOW_ID, 'async_step', 'http_request'],
      ['in_fallback_chain', REFUSALS_WORKFLOW_ID, 'kyc_step', 'mock_kyc_2'],
      ['multiple_connectors', REFUSALS_WORKFLOW_ID, 'two_slots', 'mock_kyc_2'],
      ['adapter_not_registered', REFUSALS_WORKFLOW_ID, 'kyc_step', 'no_such_adapter'],
      ['callback_fields_missing', REFUSALS_WORKFLOW_ID, 'kyc_step', 'veriff_kyc'],
      ['declaration_invalid', REFUSALS_WORKFLOW_ID, 'sumsub_step', 'sumsub_kyc'],
    ])('answers 400 %s', async (reason, workflowId, stepName, connectorId) => {
      const response = await selectConnector(workflowId, stepName, { connectorId }).expect(400);

      expect(response.body).toMatchObject({
        code: 'WORKFLOW_CONNECTOR_SELECTION_INVALID',
        stepName,
        connectorId,
        workflowVersion: 1,
        reason,
      });
      await expect(readSlot(workflowId, stepName)).resolves.toMatchObject({ selected: false });
    });

    it('offers only the ids a save would accept, and none for a step a selection cannot address', async () => {
      // The chain id and the two real providers are refused above, so none of them is offered.
      await expect(readSlot(REFUSALS_WORKFLOW_ID, 'kyc_step')).resolves.toMatchObject({
        selectableIds: ['mock_kyc_1', 'mock_sumsub_file_upload'],
      });
      // `sumsub_kyc` passes the callback-fields check here but its declaration rules throw, and
      // `mock_kyc_2` sits in no chain on this step, so it is offered again.
      await expect(readSlot(REFUSALS_WORKFLOW_ID, 'sumsub_step')).resolves.toMatchObject({
        selectableIds: SELECTABLE_FOR_PLAIN_KYC_SLOT,
      });
      await expect(readSlot(REFUSALS_WORKFLOW_ID, 'two_slots')).resolves.toMatchObject({
        selectableIds: [],
      });
    });

    it('answers 400 for a body that is not a connector id', async () => {
      const response = await selectConnector(SYNC_WORKFLOW_ID, 'verify', {
        connectorId: 'Not A Connector Id',
      }).expect(400);

      expect(response.body.message).toEqual(expect.arrayContaining([expect.any(String)]));
      await selectConnector(SYNC_WORKFLOW_ID, 'verify', {}).expect(400);
    });
  });

  describe('an asynchronous slot', () => {
    it('lets an onboarding parked before the switch finish with the provider it started on', async () => {
      const providerOne = app.get(MockAsyncCallbackConnector);
      const providerTwo = app.get(MockAsyncCallback2Connector);

      const onboardingA = await startOnboarding(ASYNC_WORKFLOW_ID);
      await http().post(`/v1/onboardings/${onboardingA}/submit`).send({}).expect(201);
      const initiationA = providerOne.getLatestInitiation();
      expect(initiationA).toMatchObject({ onboardingId: onboardingA, connectorOrder: 1 });
      await expect(readPendingConnector(onboardingA)).resolves.toEqual({
        connectorName: ASYNC_PROVIDER_ID,
        connectorId: ASYNC_PROVIDER_ID,
        connectorOrder: 1,
        providerReference: initiationA.providerReference,
        parkedAt: expect.any(String),
      });

      await selectConnector(ASYNC_WORKFLOW_ID, 'await_provider', {
        connectorId: ASYNC_PROVIDER_2_ID,
      }).expect(200);

      const onboardingB = await startOnboarding(ASYNC_WORKFLOW_ID);
      await http().post(`/v1/onboardings/${onboardingB}/submit`).send({}).expect(201);
      const initiationB = providerTwo.getLatestInitiation();
      expect(initiationB).toMatchObject({ onboardingId: onboardingB, connectorOrder: 1 });
      await expect(readPendingConnector(onboardingB)).resolves.toMatchObject({
        connectorId: ASYNC_PROVIDER_2_ID,
        connectorOrder: 1,
        providerReference: initiationB.providerReference,
      });

      const resolver = app.get(AwaitingCallbackConnectorResolver);
      await expect(
        resolver.findConnector({ onboardingId: onboardingA, connectorId: ASYNC_PROVIDER_ID }),
      ).resolves.toMatchObject({
        connectorOrder: 1,
        pendingConnector: { providerReference: initiationA.providerReference },
      });
      await expect(
        resolver.findConnector({ onboardingId: onboardingA, connectorId: ASYNC_PROVIDER_2_ID }),
      ).resolves.toBeUndefined();

      await postCallback(
        ASYNC_PROVIDER_ID,
        providerOne.emitProviderCallback({
          providerReference: initiationA.providerReference,
          submittedData: {},
        }).rawBody,
      ).expect(204);
      await expect(readOnboardingStatus(onboardingA)).resolves.toBe('approved');
      await expect(readPendingConnector(onboardingA)).resolves.toBeNull();
      await expect(readOnboardingStatus(onboardingB)).resolves.toBe('awaiting_user');

      await postCallback(
        ASYNC_PROVIDER_2_ID,
        providerTwo.emitProviderCallback({
          providerReference: initiationB.providerReference,
          submittedData: {},
        }).rawBody,
      ).expect(204);
      await expect(readOnboardingStatus(onboardingB)).resolves.toBe('approved');
      await expect(readPendingConnector(onboardingB)).resolves.toBeNull();

      await clearConnector(ASYNC_WORKFLOW_ID, 'await_provider').expect(204);
    });
  });

  describe('the compile dry run', () => {
    it('reports the authored connector while a selection is stored', async () => {
      await selectConnector(SYNC_WORKFLOW_ID, 'verify', { connectorId: 'mock_kyc_2' }).expect(200);

      try {
        const response = await http()
          .post('/v1/admin/workflows/compile')
          .set('Authorization', `Bearer ${token}`)
          .send(syncWorkflow)
          .expect(200);
        const step = (
          response.body.workflow.steps as Array<{
            name: string;
            connectors: ProjectedConnector[];
          }>
        ).find((candidate) => candidate.name === 'verify');

        expect(step?.connectors[0]).toMatchObject({
          id: 'mock_kyc_1',
          authoredId: 'mock_kyc_1',
          selected: false,
        });
        expect(step?.connectors[0].selectableIds).toEqual(SELECTABLE_FOR_PLAIN_KYC_SLOT);
      } finally {
        await clearConnector(SYNC_WORKFLOW_ID, 'verify').expect(204);
      }
    });
  });
});
