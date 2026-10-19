import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OnboardingEntity } from '../src/onboardings/entity/onboarding.entity';
import { startE2eServer } from './e2e-server';

const WORKFLOW_ID = 'lean-ksa';
const IBAN_CONNECTOR_ID = 'lean_iban_verification';
const BANK_DATA_CONNECTOR_ID = 'lean_bank_data';
const LEAN_CONNECTOR_IDS = [IBAN_CONNECTOR_ID, BANK_DATA_CONNECTOR_ID];

// Hosts nothing answers on: every call to them is served by the in-process stub below.
const LEAN_AUTH_BASE_URL = 'http://lean-auth.e2e.test';
const LEAN_API_BASE_URL = 'http://lean-api.e2e.test';

// Fake values: no Lean account backs them. The app token is the one the stub accepts.
const FAKE_CLIENT_ID = 'e2e-fake-lean-client-id';
const FAKE_CLIENT_SECRET = 'e2e-fake-lean-client-secret';
const FAKE_CALLBACK_SIGNING_SECRET = 'e2e-fake-lean-callback-signing-secret';
const FAKE_ACCESS_TOKEN = 'e2e-fake-lean-access-token';

const MATCHING_IBAN = 'SA2810000011100000461309';
const MATCHING_NATIONAL_ID = '1106972886';
const WEBHOOK_ROUTE = `/v1/webhooks/${BANK_DATA_CONNECTOR_ID}/callback`;
const MIN_MONTHLY_SALARY = 4000;

type LeanFake = {
  customers: Map<string, string>;
  income: unknown;
  employment: unknown;
  calls: string[];
};

type VerifyAccountBody = {
  account_details?: { value?: string };
  identifications?: Array<{ value?: string }>;
};

type LeanIncomeStub = { salaryAverage: number };

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const buildIncome = ({ salaryAverage }: LeanIncomeStub) => ({
  status: 'OK',
  results_id: randomUUID(),
  insights: {
    salary: {
      currency: 'SAR',
      total: {
        amount: salaryAverage * 6,
        count: 6,
        average_monthly_amount: salaryAverage,
      },
      monthly_totals: [1, 2, 3, 4, 5, 6].map((month) => ({
        month,
        year: 2026,
        amount: salaryAverage,
        count: 1,
      })),
    },
    non_salary: {
      currency: 'SAR',
      total: { amount: 600, count: 2, average_monthly_amount: 100 },
      monthly_totals: [],
    },
  },
});

const buildEmployment = () => ({
  status: 'OK',
  results_id: randomUUID(),
  insights: {
    employment_details: [
      {
        bank_employer_name: 'E2E EMPLOYER CO',
        matched_reference_employer: { name: { en: 'E2E Employer', ar: 'e2e' }, cr_number: 1 },
        salary_consistent: true,
      },
    ],
  },
});

describe('Lean KSA connectors on lean-ksa (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let realFetch: typeof globalThis.fetch;
  let savedConnectorRows: Array<{
    id: string;
    type: string;
    settings: unknown;
    updated_at: Date;
    updated_by: string | null;
  }>;
  const lean: LeanFake = {
    customers: new Map(),
    income: undefined,
    employment: undefined,
    calls: [],
  };
  const createdOnboardingIds = new Set<string>();

  const http = () => request(app.getHttpServer());

  /** Answers the Lean endpoints the adapters call, and nothing else. */
  const leanFetch = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);

    if (url.origin !== LEAN_AUTH_BASE_URL && url.origin !== LEAN_API_BASE_URL) {
      return realFetch(input, init);
    }

    const method = init?.method ?? 'GET';
    lean.calls.push(`${method} ${url.pathname}`);

    if (url.origin === LEAN_AUTH_BASE_URL) {
      return Promise.resolve(
        url.pathname === '/oauth2/token' && method === 'POST'
          ? jsonResponse(200, {
              access_token: FAKE_ACCESS_TOKEN,
              token_type: 'Bearer',
              scope: 'api',
              expires_in: 3599,
            })
          : jsonResponse(404, { status: 'NOT_FOUND', message: 'no such route' }),
      );
    }

    const authorization = new Headers(init?.headers).get('authorization');

    if (authorization !== `Bearer ${FAKE_ACCESS_TOKEN}`) {
      return Promise.resolve(jsonResponse(401, { status: 'UNAUTHORIZED', message: 'bad token' }));
    }

    const body: VerifyAccountBody =
      typeof init?.body === 'string' ? (JSON.parse(init.body) as VerifyAccountBody) : {};

    if (method === 'POST' && url.pathname === '/verifications/v1/accounts') {
      const matches =
        body.account_details?.value === MATCHING_IBAN &&
        body.identifications?.[0]?.value === MATCHING_NATIONAL_ID;

      return Promise.resolve(
        jsonResponse(200, {
          status: 'OK',
          results_id: randomUUID(),
          message: 'ok',
          status_detail: null,
          verifications: {
            account_ownership_verified: matches,
            matching: matches ? null : { type: 'NO_MATCH', score: 0 },
            account_status: matches ? 'ACTIVE' : null,
            account_holder_name: null,
            verification_method: 'CONFIRMATION_OF_PAYEE_SERVICE',
          },
        }),
      );
    }

    const customerMatch = /^\/customers\/v1\/([^/]+)(\/entities)?$/.exec(url.pathname);

    if (method === 'GET' && customerMatch) {
      const [, customerId, entities] = customerMatch;
      const appUserId = lean.customers.get(customerId);

      if (appUserId === undefined) {
        return Promise.resolve(
          jsonResponse(404, { status: 'UNKNOWN_CUSTOMER', message: 'unknown' }),
        );
      }

      return Promise.resolve(
        jsonResponse(
          200,
          entities
            ? [
                {
                  id: randomUUID(),
                  customer_id: customerId,
                  bank_identifier: 'LEA1',
                  created_at: '2026-10-13T10:00:00Z',
                },
              ]
            : { customer_id: customerId, app_user_id: appUserId },
        ),
      );
    }

    if (method === 'POST' && url.pathname === '/insights/v2/income') {
      return Promise.resolve(jsonResponse(200, lean.income));
    }

    if (method === 'GET' && url.pathname === '/insights/v2/income/employment') {
      return Promise.resolve(jsonResponse(200, lean.employment));
    }

    return Promise.resolve(jsonResponse(404, { status: 'NOT_FOUND', message: 'no such route' }));
  };

  const setSalary = (salaryAverage: number) => {
    lean.income = buildIncome({ salaryAverage });
    lean.employment = buildEmployment();
  };

  const signedWebhook = (envelope: Record<string, unknown>) => {
    const rawBody = JSON.stringify(envelope);
    const signature = createHmac('sha512', FAKE_CALLBACK_SIGNING_SECRET)
      .update(rawBody)
      .digest('hex');

    return http()
      .post(WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .set('lean-signature', `sha512=${signature}`)
      .send(rawBody);
  };

  const finishedRefresh = (customerId: string) => ({
    type: 'entity.data.refresh.updated',
    payload: {
      customer_id: customerId,
      entity_id: randomUUID(),
      status: 'FINISHED',
      data_status: { accounts: 'SUCCESS', account_data: [{ transactions: 'SUCCESS' }] },
    },
  });

  const readOnboarding = async (onboardingId: string) => {
    const row = await dataSource
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });
    const pending: Array<{ pending_connector: Record<string, unknown> | null }> =
      await dataSource.query('SELECT pending_connector FROM onboardings WHERE id = $1', [
        onboardingId,
      ]);

    return {
      status: row.status,
      currentStep: row.currentStep,
      context: row.context as Record<string, unknown>,
      pendingConnector: pending[0].pending_connector,
    };
  };

  const submit = (onboardingId: string, body: Record<string, unknown>) =>
    http().post(`/v1/onboardings/${onboardingId}/submit`).send(body);

  const startAtBankConnect = async (): Promise<string> => {
    const started = await http()
      .post('/v1/onboardings')
      .send({ workflowId: WORKFLOW_ID })
      .expect(201);
    const onboardingId = started.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    const collected = await submit(onboardingId, {
      iban: MATCHING_IBAN,
      nationalId: MATCHING_NATIONAL_ID,
    });
    expect([200, 201]).toContain(collected.status);
    expect(collected.body).toMatchObject({
      appliedStep: 'collect_bank_account',
      currentStep: 'verify_iban',
    });

    return onboardingId;
  };

  const startParked = async (): Promise<{ onboardingId: string; customerId: string }> => {
    const onboardingId = await startAtBankConnect();
    const verified = await submit(onboardingId, {});
    expect([200, 201]).toContain(verified.status);

    const customerId = randomUUID();
    lean.customers.set(customerId, onboardingId);
    const parked = await submit(onboardingId, { leanCustomerId: customerId });
    expect([200, 201]).toContain(parked.status);

    return { onboardingId, customerId };
  };

  beforeAll(async () => {
    process.env.LEAN_AUTH_BASE_URL = LEAN_AUTH_BASE_URL;
    process.env.LEAN_API_BASE_URL = LEAN_API_BASE_URL;
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';

    const { createApp } = await import('../src/main');

    app = (await createApp()).app;
    await startE2eServer(app);
    dataSource = app.get(DataSource);

    // The connectors table is shared with local use of the stack, so what an operator stored for
    // these two ids is put back afterwards.
    savedConnectorRows = await dataSource.query('SELECT * FROM connectors WHERE id = ANY($1)', [
      LEAN_CONNECTOR_IDS,
    ]);

    await http()
      .put(`/v1/admin/connectors/${IBAN_CONNECTOR_ID}`)
      .send({ settings: { clientId: FAKE_CLIENT_ID, clientSecret: FAKE_CLIENT_SECRET } })
      .expect(200);
    await http()
      .put(`/v1/admin/connectors/${BANK_DATA_CONNECTOR_ID}`)
      .send({
        settings: {
          clientId: FAKE_CLIENT_ID,
          clientSecret: FAKE_CLIENT_SECRET,
          callbackSigningSecret: FAKE_CALLBACK_SIGNING_SECRET,
        },
      })
      .expect(200);
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

      await dataSource.query('DELETE FROM connectors WHERE id = ANY($1)', [LEAN_CONNECTOR_IDS]);

      for (const row of savedConnectorRows ?? []) {
        await dataSource.query(
          'INSERT INTO connectors (id, type, settings, updated_at, updated_by) VALUES ($1, $2, $3::jsonb, $4, $5)',
          [row.id, row.type, JSON.stringify(row.settings), row.updated_at, row.updated_by],
        );
      }
    }

    await app?.close();
  });

  beforeEach(() => {
    realFetch = globalThis.fetch;
    lean.customers.clear();
    lean.calls = [];
    setSalary(MIN_MONTHLY_SALARY + 2000);
    jest.spyOn(globalThis, 'fetch').mockImplementation(leanFetch);
  });

  it('moves a matching IBAN from verify_iban to bank_connect', async () => {
    const onboardingId = await startAtBankConnect();

    const verified = await submit(onboardingId, {});

    expect([200, 201]).toContain(verified.status);
    expect(verified.body).toMatchObject({
      appliedStep: 'verify_iban',
      currentStep: 'bank_connect',
    });
    expect(lean.calls).toEqual(['POST /oauth2/token', 'POST /verifications/v1/accounts']);
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'bank_connect',
      pendingConnector: null,
    });
  });

  it('refuses a bank_connect submit without leanCustomerId and stays on the step', async () => {
    const onboardingId = await startAtBankConnect();
    await submit(onboardingId, {}).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );

    const refused = await submit(onboardingId, {}).expect(400);

    expect(refused.body).toMatchObject({
      code: 'INVALID_STEP_DATA',
      errors: { leanCustomerId: expect.any(Array) },
    });
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'bank_connect',
      pendingConnector: null,
    });
  });

  it('refuses a customer that belongs to another onboarding and stays on bank_connect', async () => {
    const onboardingId = await startAtBankConnect();
    await submit(onboardingId, {}).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );
    const foreignCustomerId = randomUUID();
    lean.customers.set(foreignCustomerId, randomUUID());

    const refused = await submit(onboardingId, { leanCustomerId: foreignCustomerId }).expect(400);

    expect(refused.body).toMatchObject({
      code: 'INVALID_STEP_DATA',
      errors: { leanCustomerId: expect.any(Array) },
    });
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'bank_connect',
      pendingConnector: null,
    });
  });

  it("parks bank_connect on the onboarding's own customer", async () => {
    const { onboardingId, customerId } = await startParked();

    const state = await readOnboarding(onboardingId);

    expect(state.currentStep).toBe('bank_connect');
    expect(state.pendingConnector).toMatchObject({
      connectorId: BANK_DATA_CONNECTOR_ID,
      providerReference: customerId,
    });
  });

  it('keeps the park through a signed entity.created', async () => {
    const { onboardingId, customerId } = await startParked();

    const created = await signedWebhook({
      type: 'entity.created',
      payload: { customer_id: customerId, app_user_id: onboardingId, entity_id: randomUUID() },
    });

    expect(created.status).toBeGreaterThanOrEqual(200);
    expect(created.status).toBeLessThan(300);
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'bank_connect',
      pendingConnector: expect.objectContaining({ providerReference: customerId }),
    });
  });

  it('approves on a finished refresh with a salary above the threshold', async () => {
    const { onboardingId, customerId } = await startParked();

    const finished = await signedWebhook(finishedRefresh(customerId));

    expect(finished.status).toBeGreaterThanOrEqual(200);
    expect(finished.status).toBeLessThan(300);
    // The callback settles bank_connect; routing on its fields is the decision step's own submit.
    const settled = await readOnboarding(onboardingId);
    expect(settled.currentStep).toBe('affordability_decision');
    expect(settled.pendingConnector).toBeNull();
    expect(settled.context).toMatchObject({
      bankConnectOutcome: 'connected',
      salaryThresholdMet: true,
      salaryConsistent: true,
      salaryMonthlyAverage: MIN_MONTHLY_SALARY + 2000,
    });
    expect(lean.calls).toEqual(
      expect.arrayContaining(['POST /insights/v2/income', 'GET /insights/v2/income/employment']),
    );

    await submit(onboardingId, {}).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      status: 'approved',
      currentStep: null,
    });
  });

  it('routes a finished refresh below the salary threshold to manual_review', async () => {
    setSalary(MIN_MONTHLY_SALARY - 1000);
    const { onboardingId, customerId } = await startParked();

    await signedWebhook(finishedRefresh(customerId)).expect((response) =>
      expect(response.status).toBeLessThan(300),
    );
    await submit(onboardingId, {}).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );

    const state = await readOnboarding(onboardingId);
    expect(state.currentStep).toBe('manual_review');
    expect(state.context).toMatchObject({
      bankConnectOutcome: 'connected',
      salaryThresholdMet: false,
    });
  });

  it('rejects a webhook with a bad signature and leaves the park', async () => {
    const { onboardingId, customerId } = await startParked();
    const rawBody = JSON.stringify(finishedRefresh(customerId));
    const wrongSignature = createHmac('sha512', 'not-the-signing-secret')
      .update(rawBody)
      .digest('hex');

    const rejected = await http()
      .post(WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .set('lean-signature', `sha512=${wrongSignature}`)
      .send(rawBody)
      .expect(401);

    expect(rejected.body).toMatchObject({ code: 'ASYNC_CALLBACK_SIGNATURE_INVALID' });
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'bank_connect',
      pendingConnector: expect.objectContaining({ providerReference: customerId }),
    });
  });

  it('acknowledges a signed bank.availability.updated with 204 and changes nothing', async () => {
    const { onboardingId, customerId } = await startParked();

    await signedWebhook({
      type: 'bank.availability.updated',
      payload: { bank_identifier: 'LEA1_SAMAOB_SAU', availability: 'AVAILABLE' },
    }).expect(204);

    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      status: 'awaiting_user',
      currentStep: 'bank_connect',
      pendingConnector: expect.objectContaining({ providerReference: customerId }),
    });
  });
});
