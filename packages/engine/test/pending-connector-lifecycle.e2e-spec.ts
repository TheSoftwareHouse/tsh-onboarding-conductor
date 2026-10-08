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
import { MockAsyncCallbackConnector } from '../src/connectors/adapters/fixtures/mock-async-callback.connector';
import { exceptionFactory } from '../src/validation/validation-exception.factory';
import { startE2eServer } from './e2e-server';

const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const AUDIENCE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_ID = 'pending-connector-lifecycle-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-0000000000ef';

const WORKFLOW_ID = 'pending-connector-lifecycle-e2e';
const PROVIDER_ID = 'mock_async_callback';
const WEBHOOK_ROUTE_PREFIX = '/v1/webhooks/';

const workflow = {
  id: WORKFLOW_ID,
  version: 1,
  initial: 'await_provider',
  steps: [
    {
      name: 'await_provider',
      type: 'custom',
      config: {
        status: 'awaiting_user',
        data: {},
        connectors: [
          {
            name: PROVIDER_ID,
            id: PROVIDER_ID,
            type: 'custom',
            order: 1,
            async: true,
            fieldMapping: {},
          },
        ],
        transitions: [{ status: 'success', target: 'done' }],
      },
    },
    { name: 'done', type: 'custom', config: { status: 'approved', data: {}, transitions: [] } },
  ],
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

describe('Parked onboarding lifecycle (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let workflowsDir: string;
  let token: string;
  let provider: MockAsyncCallbackConnector;

  const createdOnboardingIds = new Set<string>();

  const http = () => request(app.getHttpServer());

  const admin = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);

  const startParked = async (): Promise<{ onboardingId: string; providerReference: string }> => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: WORKFLOW_ID })
      .expect(201);
    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    await http().post(`/v1/onboardings/${onboardingId}/submit`).send({}).expect(201);
    const initiation = provider.getLatestInitiation();
    expect(initiation).toMatchObject({ onboardingId, connectorOrder: 1 });

    return { onboardingId, providerReference: initiation!.providerReference };
  };

  const readPendingConnector = async (
    onboardingId: string,
  ): Promise<Record<string, unknown> | null> => {
    const rows: PendingConnectorRow[] = await dataSource.query(
      'SELECT pending_connector FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return rows[0].pending_connector;
  };

  const readStatus = async (onboardingId: string): Promise<string> => {
    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return rows[0].status;
  };

  const readAuditRows = (resourceId: string, action: string): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT actor_type, actor_id, action, entry_type, resource_type, resource_id, metadata
         FROM audit_log
        WHERE resource_id = $1 AND action = $2
        ORDER BY occurred_at, id`,
      [resourceId, action],
    );

  const readLatestCallbackRejection = async (): Promise<AuditRow | undefined> => {
    const rows: AuditRow[] = await dataSource.query(
      `SELECT actor_type, actor_id, action, entry_type, resource_type, resource_id, metadata
         FROM audit_log
        WHERE resource_type = 'provider_callback' AND action = 'webhook.inbound_callback_rejected'
        ORDER BY occurred_at DESC, id DESC
        LIMIT 1`,
    );

    return rows[0];
  };

  const postCallback = (rawBody: Uint8Array) =>
    http()
      .post(`${WEBHOOK_ROUTE_PREFIX}${PROVIDER_ID}/callback`)
      .set('content-type', 'application/json')
      .send(Buffer.from(rawBody).toString('utf8'));

  const reconcile = (onboardingId: string) =>
    admin(http().post(`/v1/onboardings/${onboardingId}/pending-connector/reconcile`));

  beforeAll(async () => {
    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-pending-connector-workflows-'));
    writeFileSync(
      path.join(workflowsDir, `${WORKFLOW_ID}.workflow.json`),
      JSON.stringify(workflow),
    );

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
    const isCallback = (req: { originalUrl?: string; url?: string }): boolean =>
      (req.originalUrl ?? req.url ?? '').split('?')[0].startsWith(WEBHOOK_ROUTE_PREFIX);
    app.useBodyParser('raw', { type: (req) => isCallback(req) });
    app.useBodyParser('json', { strict: false, type: (req) => !isCallback(req) });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, exceptionFactory }));
    await startE2eServer(app);
    dataSource = app.get(DataSource);
    provider = app.get(MockAsyncCallbackConnector);

    token = await new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OBJECT_ID,
      preferred_username: 'pending.connector@tsh.io',
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

      await dataSource.query('DELETE FROM workflows WHERE key = $1', [WORKFLOW_ID]);
    }

    await app?.close();

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  it('parks with the time it was parked, and reports it on the admin summary', async () => {
    const { onboardingId, providerReference } = await startParked();

    const park = await readPendingConnector(onboardingId);
    expect(park).toMatchObject({
      connectorId: PROVIDER_ID,
      connectorOrder: 1,
      providerReference,
      parkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });

    const summary = await admin(http().get(`/v1/onboardings/${onboardingId}`)).expect(200);
    expect(summary.body.pendingConnector).toEqual({
      connectorId: PROVIDER_ID,
      connectorName: PROVIDER_ID,
      connectorOrder: 1,
      parkedAt: park!.parkedAt,
    });
    expect(JSON.stringify(summary.body)).not.toContain(providerReference);
  });

  it('refuses a second client submit while parked, without opening a second provider attempt', async () => {
    const { onboardingId, providerReference } = await startParked();

    const refused = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({})
      .expect(409);
    expect(refused.body).toEqual({
      code: 'ONBOARDING_AWAITING_CONNECTOR',
      message: 'ONBOARDING_AWAITING_CONNECTOR',
      pendingConnector: { connectorId: PROVIDER_ID, connectorName: PROVIDER_ID, connectorOrder: 1 },
    });
    expect(provider.getLatestInitiation()?.providerReference).toBe(providerReference);

    const rejected = await readAuditRows(onboardingId, 'onboarding.rejected_attempt');
    expect(rejected).toEqual([
      expect.objectContaining({
        entry_type: 'rejected',
        metadata: expect.objectContaining({ operation: 'submit', outcome: 'awaiting_connector' }),
      }),
    ]);

    // The callback the park waits on still decides the onboarding.
    await postCallback(
      provider.emitProviderCallback({ providerReference, submittedData: {} }).rawBody,
    ).expect(204);
    await expect(readStatus(onboardingId)).resolves.toBe('approved');
    await expect(readPendingConnector(onboardingId)).resolves.toBeNull();
  });

  it('drops a callback computed for a park the row no longer holds', async () => {
    const { onboardingId, providerReference } = await startParked();

    // The engine is told, as a client submit would have, that the onboarding now waits on
    // another attempt.
    await dataSource.query(
      `UPDATE onboardings
          SET pending_connector = jsonb_set(pending_connector, '{providerReference}', '"other-attempt"')
        WHERE id = $1`,
      [onboardingId],
    );

    await postCallback(
      provider.emitProviderCallback({ providerReference, submittedData: {} }).rawBody,
    ).expect(204);

    await expect(readStatus(onboardingId)).resolves.toBe('awaiting_user');
    await expect(readPendingConnector(onboardingId)).resolves.toMatchObject({
      providerReference: 'other-attempt',
    });
    await expect(readLatestCallbackRejection()).resolves.toEqual(
      expect.objectContaining({ metadata: { reason: 'callback_superseded' } }),
    );
    await expect(readAuditRows(onboardingId, 'onboarding.state_transition')).resolves.toHaveLength(
      1,
    );
  });

  describe('the operator reconcile', () => {
    it('refuses an onboarding that is not parked', async () => {
      const response = await http()
        .post('/v1/onboardings')
        .send({ workflowId: WORKFLOW_ID })
        .expect(201);
      const onboardingId = response.body.onboardingId as string;
      createdOnboardingIds.add(onboardingId);

      const refused = await reconcile(onboardingId).expect(409);
      expect(refused.body.code).toBe('ONBOARDING_NOT_AWAITING_CONNECTOR');
    });

    it('answers still_pending and changes nothing while the provider has not decided', async () => {
      const { onboardingId, providerReference } = await startParked();

      const response = await reconcile(onboardingId).expect(200);
      expect(response.body.outcome).toBe('still_pending');
      expect(response.body.onboarding).toMatchObject({
        onboardingId,
        status: 'awaiting_user',
        pendingConnector: expect.objectContaining({ connectorId: PROVIDER_ID }),
      });
      await expect(readPendingConnector(onboardingId)).resolves.toMatchObject({
        providerReference,
      });

      await expect(
        readAuditRows(onboardingId, 'onboarding.pending_connector_reconcile_noop'),
      ).resolves.toEqual([
        expect.objectContaining({
          actor_type: 'operator',
          actor_id: OPERATOR_OBJECT_ID,
          entry_type: 'observed',
          resource_type: 'onboarding',
          metadata: { connectorId: PROVIDER_ID, connectorOrder: 1, outcome: 'still_pending' },
        }),
      ]);
    });

    it('applies the verdict the provider holds under the operator who asked', async () => {
      const { onboardingId, providerReference } = await startParked();
      // The step collects nothing, so the provider echoes an empty submission, as its callback would.
      provider.setReconcileOutcome(providerReference, { status: 'accepted', submittedData: {} });

      const response = await reconcile(onboardingId).expect(200);
      expect(response.body.outcome).toBe('applied');
      expect(response.body.onboarding).toMatchObject({
        onboardingId,
        status: 'approved',
        pendingConnector: null,
      });
      await expect(readStatus(onboardingId)).resolves.toBe('approved');
      await expect(readPendingConnector(onboardingId)).resolves.toBeNull();

      await expect(
        readAuditRows(onboardingId, 'onboarding.pending_connector_reconciled'),
      ).resolves.toEqual([
        expect.objectContaining({
          actor_type: 'operator',
          actor_id: OPERATOR_OBJECT_ID,
          entry_type: 'success',
          metadata: {
            connectorId: PROVIDER_ID,
            connectorOrder: 1,
            providerIdentity: PROVIDER_ID,
            submittedData: {},
            connectorExecutionResult: { status: 'accepted' },
          },
        }),
      ]);
      await expect(
        readAuditRows(onboardingId, 'webhook.inbound_callback_applied'),
      ).resolves.toEqual([]);

      // The provider's own late callback was decided for a park the row no longer holds, so it is
      // acknowledged and dropped rather than refused as a submit on a completed onboarding.
      await postCallback(
        provider.emitProviderCallback({ providerReference, submittedData: {} }).rawBody,
      ).expect(204);
      await expect(readLatestCallbackRejection()).resolves.toEqual(
        expect.objectContaining({ metadata: { reason: 'callback_superseded' } }),
      );
      await expect(readStatus(onboardingId)).resolves.toBe('approved');
    });
  });

  describe('the admin list filters', () => {
    it('narrows to parked onboardings, by connector and by park time', async () => {
      const { onboardingId } = await startParked();
      const park = await readPendingConnector(onboardingId);
      const afterPark = new Date(Date.parse(park!.parkedAt as string) + 1000).toISOString();

      const parked = await admin(
        http().get('/v1/onboardings').query({ workflowId: WORKFLOW_ID, parked: 'true' }),
      ).expect(200);
      expect(
        parked.body.items.map((item: { onboardingId: string }) => item.onboardingId),
      ).toContain(onboardingId);

      const byConnector = await admin(
        http().get('/v1/onboardings').query({
          workflowId: WORKFLOW_ID,
          pendingConnectorId: PROVIDER_ID,
          parkedBefore: afterPark,
        }),
      ).expect(200);
      expect(
        byConnector.body.items.map((item: { onboardingId: string }) => item.onboardingId),
      ).toContain(onboardingId);

      const beforePark = await admin(
        http()
          .get('/v1/onboardings')
          .query({ workflowId: WORKFLOW_ID, parkedBefore: park!.parkedAt }),
      ).expect(200);
      expect(
        beforePark.body.items.map((item: { onboardingId: string }) => item.onboardingId),
      ).not.toContain(onboardingId);

      const notParked = await admin(
        http().get('/v1/onboardings').query({ workflowId: WORKFLOW_ID, parked: 'false' }),
      ).expect(200);
      expect(
        notParked.body.items.map((item: { onboardingId: string }) => item.onboardingId),
      ).not.toContain(onboardingId);

      await admin(
        http().get('/v1/onboardings').query({ pendingConnectorId: 'Not A Connector' }),
      ).expect(400);
      await admin(http().get('/v1/onboardings').query({ parkedBefore: 'yesterday' })).expect(400);
    });
  });
});
