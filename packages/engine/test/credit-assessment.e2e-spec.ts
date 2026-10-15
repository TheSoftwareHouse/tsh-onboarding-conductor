import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type KeyLike } from 'jose';
import { buildMockCreditCallbackBody } from '../src/connectors/adapters/fixtures/mock-credit.connector';
import { exceptionFactory } from '../src/validation/validation-exception.factory';
import { startE2eServer } from './e2e-server';

// The bank-data fixture is a copy of an Algoan demo persona: see fixtures/bank-data/NOTICE.md and
// packages/demo-bff/personas/LICENSE-algoan.txt.
const TENANT_ID = '99999999-9999-9999-9999-999999999999';
const AUDIENCE = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const KEY_ID = 'credit-assessment-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-0000000000ef';

// Checked in under workflows/fixtures/, which the engine loads on boot.
const WORKFLOW_ID = 'credit-check';
const PROVIDER_ID = 'mock_credit';
const WEBHOOK_ROUTE_PREFIX = '/v1/webhooks/';

const BANK_DATA_JSON = readFileSync(
  path.join(__dirname, 'fixtures', 'bank-data', 'sherlock_holmes.json'),
  'utf8',
);

type AuditRow = { action: string; metadata: Record<string, unknown> };

describe('Credit assessment step (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let token: string;

  const createdOnboardingIds = new Set<string>();

  const http = () => request(app.getHttpServer());

  const admin = (test: request.Test) => test.set('Authorization', `Bearer ${token}`);

  const bankDataFor = (ownerName?: string): string => {
    if (ownerName === undefined) {
      return BANK_DATA_JSON;
    }

    const document = JSON.parse(BANK_DATA_JSON) as { accounts: Array<{ owners: unknown[] }> };
    document.accounts[0].owners = [{ name: ownerName }];

    return JSON.stringify(document);
  };

  const start = async (): Promise<string> => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: WORKFLOW_ID })
      .expect(201);
    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    return onboardingId;
  };

  const uploadBankData = async (onboardingId: string, content: string): Promise<string> => {
    const bytes = Buffer.from(content, 'utf8');
    const reservation = await http()
      .post(`/v1/onboardings/${onboardingId}/documents`)
      .send({ field: 'bankData', contentType: 'application/json', sizeBytes: bytes.byteLength })
      .expect(201);
    const documentId = reservation.body.documentId as string;
    const ticket = reservation.body.upload as { url: string; fields: Record<string, string> };

    const form = new FormData();
    for (const [name, value] of Object.entries(ticket.fields)) {
      form.append(name, value);
    }
    form.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: 'application/json' }),
      'bank-data.json',
    );
    const uploaded = await fetch(ticket.url, { method: 'POST', body: form });
    expect(uploaded.ok).toBe(true);

    await http()
      .post(`/v1/onboardings/${onboardingId}/documents/${documentId}/complete`)
      .send({})
      .expect((response) => expect([200, 201]).toContain(response.status));

    return documentId;
  };

  const submitCollectSteps = async (onboardingId: string) => {
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ firstName: 'Sherlock', lastName: 'Holmes', email: 'sherlock@example.com' })
      .expect(201);
    await submitConsent(onboardingId);
    await submitBankJourney(onboardingId);
  };

  /** The bank journey between the credit consent and the bank data: the steps the retry edge skips back over. */
  const submitBankJourney = async (onboardingId: string) => {
    const submit = (body: Record<string, unknown>) =>
      http().post(`/v1/onboardings/${onboardingId}/submit`).send(body).expect(201);

    await submit({ bankId: 'algoan_demo_bank', bankName: 'Algoan Demo Bank' });
    await submit({
      bankConnectionReference: '0123456789abcdef0123456789abcdef',
      bankConnectionMethod: 'device',
      bankProfile: 'high',
    });
    await submitAccountSelection(onboardingId);
  };

  const submitAccountSelection = async (onboardingId: string) => {
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ selectedAccounts: ['account-01', 'account-02'] })
      .expect(201);
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ bankDataAccessVersion: '2026-10', bankDataAccessConsent: true })
      .expect(201);
  };

  const submitConsent = (onboardingId: string) =>
    http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ openBankingCreditCheckVersion: '2026-10', openBankingCreditCheckConsent: true })
      .expect(201);

  /** Collect, upload and submit the bank data: the onboarding is parked on the provider after this. */
  const parkOn = async (onboardingId: string, content: string): Promise<string> => {
    const documentId = await uploadBankData(onboardingId, content);
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ bankData: documentId })
      .expect(201);

    const rows: Array<{ pending_connector: { providerReference: string } | null }> =
      await dataSource.query('SELECT pending_connector FROM onboardings WHERE id = $1', [
        onboardingId,
      ]);
    expect(rows[0].pending_connector).not.toBeNull();

    return rows[0].pending_connector!.providerReference;
  };

  const postCallback = (onboardingId: string, providerReference: string) =>
    http()
      .post(`${WEBHOOK_ROUTE_PREFIX}${PROVIDER_ID}/callback`)
      .set('content-type', 'application/json')
      .send(
        Buffer.from(buildMockCreditCallbackBody(onboardingId, providerReference)).toString('utf8'),
      );

  const readState = async (onboardingId: string) =>
    (await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200)).body;

  const readContext = async (onboardingId: string): Promise<Record<string, unknown>> => {
    const rows: Array<{ context: Record<string, unknown> }> = await dataSource.query(
      'SELECT context FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return rows[0].context;
  };

  const readAuditRows = (resourceId: string, action: string): Promise<AuditRow[]> =>
    dataSource.query(
      `SELECT action, metadata FROM audit_log
        WHERE resource_id = $1 AND action = $2 ORDER BY occurred_at, id`,
      [resourceId, action],
    );

  beforeAll(async () => {
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

    token = await new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OBJECT_ID,
      preferred_username: 'credit.assessment@tsh.io',
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
    }

    await app?.close();
  });

  it('parks on the provider, refuses a resubmit, and approves a 965 score from the callback', async () => {
    const onboardingId = await start();
    await submitCollectSteps(onboardingId);
    const providerReference = await parkOn(onboardingId, bankDataFor());

    expect(providerReference).toBe(`mock:${onboardingId}:1`);
    const parked = await readState(onboardingId);
    expect(parked.pending).toEqual({
      connectorId: PROVIDER_ID,
      parkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(JSON.stringify(parked)).not.toContain(providerReference);

    const refused = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({})
      .expect(409);
    expect(refused.body.code).toBe('ONBOARDING_AWAITING_CONNECTOR');

    await postCallback(onboardingId, providerReference).expect(204);

    const decided = await readState(onboardingId);
    expect(decided).toMatchObject({ terminal: true, pending: null });
    expect(decided.data).toMatchObject({
      creditScore: 965,
      creditOutcome: 'approved',
      creditReport: { scores: expect.anything() },
    });
    const status: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(status[0].status).toBe('approved');

    const applied = await readAuditRows(onboardingId, 'webhook.inbound_callback_applied');
    expect(applied).toHaveLength(1);
    const submitted = applied[0].metadata.submittedData as Record<string, unknown>;
    expect(submitted.creditReportBytes).toEqual(expect.any(Number));
    expect(submitted).not.toHaveProperty('creditReport');
    expect(submitted.creditOutcome).toBe('approved');
  });

  it('loops Fail Case runs back to the account selection step until the attempt cap, then sends the last failure to review', async () => {
    const onboardingId = await start();
    await submitCollectSteps(onboardingId);
    const firstReference = await parkOn(onboardingId, bankDataFor('Fail Case'));
    await postCallback(onboardingId, firstReference).expect(204);

    const retried = await readState(onboardingId);
    expect(retried.terminal).toBe(false);
    expect(retried.pending).toBeNull();
    expect(retried.currentStep).toBe('account_selection');
    await expect(readContext(onboardingId)).resolves.toMatchObject({
      creditAttemptCount: 1,
      creditOutcome: 'retry',
    });

    await submitAccountSelection(onboardingId);
    const secondReference = await parkOn(onboardingId, bankDataFor('Fail Case'));
    expect(secondReference).toBe(`mock:${onboardingId}:2`);
    await postCallback(onboardingId, secondReference).expect(204);
    expect((await readState(onboardingId)).currentStep).toBe('account_selection');

    await submitAccountSelection(onboardingId);
    const thirdReference = await parkOn(onboardingId, bankDataFor('Fail Case'));
    expect(thirdReference).toBe(`mock:${onboardingId}:3`);
    await postCallback(onboardingId, thirdReference).expect(204);

    const rows: Array<{ status: string }> = await dataSource.query(
      'SELECT status FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(rows[0].status).toBe('awaiting_manual_review');
    await expect(readContext(onboardingId)).resolves.toMatchObject({ creditAttemptCount: 3 });
  });

  it('lets an operator reconcile a park whose callback never came', async () => {
    const onboardingId = await start();
    await submitCollectSteps(onboardingId);
    await parkOn(onboardingId, bankDataFor());

    const response = await admin(
      http().post(`/v1/onboardings/${onboardingId}/pending-connector/reconcile`),
    ).expect(200);
    expect(response.body.outcome).toBe('applied');
    expect(response.body.onboarding).toMatchObject({
      onboardingId,
      status: 'approved',
      pendingConnector: null,
    });
    await expect(readContext(onboardingId)).resolves.toMatchObject({
      creditScore: 965,
      creditOutcome: 'approved',
    });
  });
});
