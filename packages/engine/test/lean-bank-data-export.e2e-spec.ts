import 'reflect-metadata';
import { createHmac, randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { buildMockCreditCallbackBody } from '../src/connectors/adapters/fixtures/mock-credit.connector';
import { startE2eServer } from './e2e-server';

// The fixture twin of the KSA BNPL journey: lean_bank_data with the export, then mock_credit in
// place of Algoan (docs/decisions/0050, 0051, 0052).
const WORKFLOW_ID = 'lean-ksa-export';
const BANK_DATA_CONNECTOR_ID = 'lean_bank_data';
const CREDIT_PROVIDER_ID = 'mock_credit';
const LEAN_WEBHOOK_ROUTE = `/v1/webhooks/${BANK_DATA_CONNECTOR_ID}/callback`;
const CREDIT_WEBHOOK_ROUTE = `/v1/webhooks/${CREDIT_PROVIDER_ID}/callback`;
const EXPORT_FIELD = 'bankDataDocument';

const LEAN_AUTH_BASE_URL = 'http://lean-auth.e2e.test';
const LEAN_API_BASE_URL = 'http://lean-api.e2e.test';
const FAKE_CLIENT_ID = 'e2e-fake-lean-client-id';
const FAKE_CLIENT_SECRET = 'e2e-fake-lean-client-secret';
const FAKE_CALLBACK_SIGNING_SECRET = 'e2e-fake-lean-callback-signing-secret';
const FAKE_ACCESS_TOKEN = 'e2e-fake-lean-access-token';
const ENTITY_ID = 'e2e-entity-1';
/** The mock provider scores this owner 965, above the fixture's approve band. */
const OWNER_NAME = 'Sherlock Holmes';
const SALARY_SAR = 30000;
const RENT_SAR = 2500;
const BALANCE_SAR = 1000;
const SAR_TO_GBP_RATE = 0.197;

type LeanFake = {
  customers: Map<string, string>;
  refuse: Set<string>;
  calls: string[];
};

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const income = () => ({
  status: 'OK',
  results_id: randomUUID(),
  insights: {
    salary: {
      currency: 'SAR',
      total: { amount: SALARY_SAR * 6, count: 6, average_monthly_amount: SALARY_SAR },
      monthly_totals: [1, 2, 3, 4, 5, 6].map((month) => ({
        month,
        year: 2026,
        amount: SALARY_SAR,
        count: 1,
      })),
    },
    non_salary: {
      currency: 'SAR',
      total: { amount: 0, count: 0, average_monthly_amount: 0 },
      monthly_totals: [],
    },
  },
});

const employment = () => ({
  status: 'OK',
  results_id: randomUUID(),
  insights: {
    employment_details: [
      {
        bank_employer_name: 'LEAN TECHNOLOGIES',
        matched_reference_employer: { name: { en: 'Lean Technologies', ar: 'lean' }, cr_number: 1 },
        salary_consistent: true,
      },
    ],
  },
});

const account = (id: string, subType: string, currency = 'SAR') => ({
  account_id: id,
  account_holder_name: OWNER_NAME,
  currency,
  account_type: 'PERSONAL',
  account_sub_type: subType,
  status: 'ACTIVE',
  account: [{ scheme_name: 'IBAN', identification: `SA28100000111000004613${id.slice(-2)}` }],
});

const balances = () => ({
  data: {
    balances: [
      {
        type: 'INTERIM_AVAILABLE',
        credit_debit_indicator: 'CREDIT',
        amount: { amount: BALANCE_SAR, currency: 'SAR' },
        date_time: '2026-10-18T00:00:00Z',
      },
    ],
  },
});

const transactions = () => ({
  data: {
    transactions: [
      {
        transaction_id: 'tx-1',
        amount: { amount: SALARY_SAR, currency: 'SAR' },
        credit_debit_indicator: 'CREDIT',
        status: 'BOOKED',
        booking_date_time: '2026-09-25T00:00:00Z',
        value_date_time: '2026-09-25T00:00:00Z',
        transaction_information: 'PAYROLL PAYMENT Lean Technologies',
      },
      {
        transaction_id: 'tx-2',
        amount: { amount: RENT_SAR, currency: 'SAR' },
        credit_debit_indicator: 'DEBIT',
        status: 'BOOKED',
        booking_date_time: '2026-09-28T00:00:00Z',
        value_date_time: '2026-09-28T00:00:00Z',
        transaction_information: 'RENT',
      },
    ],
    page: { total_elements: 2, total_pages: 1 },
  },
});

describe('Lean bank-data export into a credit assessment (e2e)', () => {
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
  const lean: LeanFake = { customers: new Map(), refuse: new Set(), calls: [] };
  const createdOnboardingIds = new Set<string>();

  const http = () => request(app.getHttpServer());

  /** Answers the Lean endpoints the adapter calls: customers, entities, insights and the data API. */
  const leanFetch = (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);

    if (url.origin !== LEAN_AUTH_BASE_URL && url.origin !== LEAN_API_BASE_URL) {
      return realFetch(input, init);
    }

    const method = init?.method ?? 'GET';
    lean.calls.push(`${method} ${url.pathname}`);

    if (url.origin === LEAN_AUTH_BASE_URL) {
      return Promise.resolve(
        jsonResponse(200, {
          access_token: FAKE_ACCESS_TOKEN,
          token_type: 'Bearer',
          scope: 'api',
          expires_in: 3599,
        }),
      );
    }

    if (new Headers(init?.headers).get('authorization') !== `Bearer ${FAKE_ACCESS_TOKEN}`) {
      return Promise.resolve(jsonResponse(401, { status: 'UNAUTHORIZED', message: 'bad token' }));
    }

    const refused = (what: string) =>
      lean.refuse.has(what)
        ? jsonResponse(403, { status: 'FORBIDDEN', message: `${what} refused` })
        : undefined;

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
        refused('entities') ??
          jsonResponse(
            200,
            entities
              ? [
                  {
                    id: ENTITY_ID,
                    customer_id: customerId,
                    bank_identifier: 'LEA1_SAMAOB_SAU',
                    bank_details: { name: 'Mockbank 1', identifier: 'LEA1_SAMAOB_SAU' },
                    created_at: '2026-10-13T10:00:00Z',
                  },
                ]
              : { customer_id: customerId, app_user_id: appUserId },
          ),
      );
    }

    if (method === 'POST' && url.pathname === '/insights/v2/income') {
      return Promise.resolve(jsonResponse(200, income()));
    }

    if (method === 'GET' && url.pathname === '/insights/v2/income/employment') {
      return Promise.resolve(jsonResponse(200, employment()));
    }

    if (method === 'GET' && url.pathname === '/data/v2/accounts') {
      return Promise.resolve(
        refused('accounts') ??
          jsonResponse(200, {
            data: {
              accounts: [
                account('acc-01', 'CURRENT'),
                account('acc-02', 'SAVINGS'),
                account('acc-03', 'CREDIT'),
                account('acc-04', 'CURRENT', 'USD'),
              ],
            },
          }),
      );
    }

    if (method === 'GET' && /^\/data\/v2\/accounts\/[^/]+\/balances$/.test(url.pathname)) {
      return Promise.resolve(jsonResponse(200, balances()));
    }

    if (method === 'GET' && /^\/data\/v2\/accounts\/[^/]+\/transactions$/.test(url.pathname)) {
      return Promise.resolve(jsonResponse(200, transactions()));
    }

    return Promise.resolve(jsonResponse(404, { status: 'NOT_FOUND', message: 'no such route' }));
  };

  const signedWebhook = (envelope: Record<string, unknown>) => {
    const rawBody = JSON.stringify(envelope);
    const signature = createHmac('sha512', FAKE_CALLBACK_SIGNING_SECRET)
      .update(rawBody)
      .digest('hex');

    return http()
      .post(LEAN_WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .set('lean-signature', `sha512=${signature}`)
      .send(rawBody);
  };

  const finishedRefresh = (customerId: string) => ({
    type: 'entity.data.refresh.updated',
    payload: {
      customer_id: customerId,
      entity_id: ENTITY_ID,
      status: 'FINISHED',
      data_status: { accounts: 'SUCCESS', account_data: [{ transactions: 'SUCCESS' }] },
    },
  });

  const readOnboarding = async (onboardingId: string) => {
    const rows: Array<{
      status: string;
      current_step: string | null;
      context: Record<string, unknown>;
      pending_connector: Record<string, unknown> | null;
    }> = await dataSource.query(
      'SELECT status, current_step, context, pending_connector FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    return {
      status: rows[0].status,
      currentStep: rows[0].current_step,
      context: rows[0].context,
      pendingConnector: rows[0].pending_connector,
    };
  };

  const submit = (onboardingId: string, body: Record<string, unknown>) =>
    http().post(`/v1/onboardings/${onboardingId}/submit`).send(body);

  const submitOk = async (onboardingId: string, body: Record<string, unknown>) => {
    const response = await submit(onboardingId, body);
    expect([200, 201]).toContain(response.status);

    return response;
  };

  /** Starts an onboarding, parks it on a Lean customer and delivers the finished refresh. */
  const connectBank = async () => {
    const started = await http()
      .post('/v1/onboardings')
      .send({ workflowId: WORKFLOW_ID })
      .expect(201);
    const onboardingId = started.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    const customerId = randomUUID();
    lean.customers.set(customerId, onboardingId);
    await submitOk(onboardingId, { leanCustomerId: customerId });

    const finished = await signedWebhook(finishedRefresh(customerId));
    expect(finished.status).toBeGreaterThanOrEqual(200);
    expect(finished.status).toBeLessThan(300);

    return onboardingId;
  };

  /** From the gate to the credit step, with the given selection. */
  const reachCreditStep = async (onboardingId: string, selectedAccounts: string[]) => {
    await submitOk(onboardingId, {});
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'account_selection',
    });
    await submitOk(onboardingId, { selectedAccounts });
    await submitOk(onboardingId, { bankDataAccessVersion: '2026-10', bankDataAccessConsent: true });
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'credit_check',
      pendingConnector: null,
    });
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

    savedConnectorRows = await dataSource.query('SELECT * FROM connectors WHERE id = $1', [
      BANK_DATA_CONNECTOR_ID,
    ]);
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
        // onboarding_documents cascades from onboardings.
        await dataSource.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          onboardingIds,
        ]);
      }

      await dataSource.query('DELETE FROM connectors WHERE id = $1', [BANK_DATA_CONNECTOR_ID]);

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
    lean.refuse.clear();
    lean.calls = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(leanFetch);
  });

  it('stores the converted document on the finished refresh and summarises the accounts', async () => {
    const onboardingId = await connectBank();

    const settled = await readOnboarding(onboardingId);
    expect(settled.currentStep).toBe('bank_data_gate');
    expect(settled.pendingConnector).toBeNull();
    expect(settled.context).toMatchObject({
      bankConnectOutcome: 'connected',
      salaryThresholdMet: true,
      employerName: 'Lean Technologies',
      [EXPORT_FIELD]: expect.any(String),
      bankAccounts: {
        accounts: [
          {
            id: 'account-01',
            type: 'CHECKING',
            name: 'Current account',
            accountNumber: '1301',
            balance: BALANCE_SAR * SAR_TO_GBP_RATE,
            currency: 'GBP',
            bankName: 'Mockbank 1',
          },
          { id: 'account-02', type: 'SAVINGS', accountNumber: '1302' },
        ],
      },
    });
    // The credit card and the USD account are dropped before any read of their data.
    expect(lean.calls.filter((call) => call.endsWith('/balances'))).toHaveLength(2);

    const documents: Array<{
      step_name: string;
      field_name: string;
      status: string;
      verified_content_type: string;
      verified_size_bytes: string;
    }> = await dataSource.query(
      'SELECT step_name, field_name, status, verified_content_type, verified_size_bytes FROM onboarding_documents WHERE id = $1 AND onboarding_id = $2',
      [settled.context[EXPORT_FIELD], onboardingId],
    );
    expect(documents).toEqual([
      {
        step_name: 'bank_connect',
        field_name: EXPORT_FIELD,
        status: 'completed',
        verified_content_type: 'application/json',
        verified_size_bytes: expect.any(String),
      },
    ]);

    const state = await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200);
    expect(state.body.data).toMatchObject({
      bankConnectOutcome: 'connected',
      bankAccounts: { accounts: expect.any(Array) },
    });
    expect(state.body.data[EXPORT_FIELD]).toBeUndefined();
  });

  it('scores only the selected accounts of the stored document and routes on the outcome', async () => {
    const onboardingId = await connectBank();
    await reachCreditStep(onboardingId, ['account-01']);

    // The credit step takes its document from bank_connect: nothing to upload, `{}` starts it.
    await submitOk(onboardingId, {});
    const parked = await readOnboarding(onboardingId);
    expect(parked.currentStep).toBe('credit_check');
    expect(parked.pendingConnector).toMatchObject({ connectorId: CREDIT_PROVIDER_ID });

    const callback = await http()
      .post(CREDIT_WEBHOOK_ROUTE)
      .set('content-type', 'application/json')
      .send(
        Buffer.from(
          buildMockCreditCallbackBody(
            onboardingId,
            parked.pendingConnector!.providerReference as string,
          ),
        ).toString('utf8'),
      );
    expect(callback.status).toBeGreaterThanOrEqual(200);
    expect(callback.status).toBeLessThan(300);

    const decided = await readOnboarding(onboardingId);
    expect(decided).toMatchObject({ status: 'approved', currentStep: null });
    expect(decided.context).toMatchObject({
      creditOutcome: 'approved',
      creditScore: 965,
      creditAttemptCount: 1,
    });
    const report = decided.context.creditReport as { accounts: Array<Record<string, unknown>> };
    expect(report.accounts).toHaveLength(1);
    expect(report.accounts[0]).toMatchObject({ type: 'CHECKING', currency: 'GBP' });
  });

  it('refuses a selection that names no account of the document on the selection field', async () => {
    const onboardingId = await connectBank();
    await reachCreditStep(onboardingId, ['account-09']);

    const refused = await submit(onboardingId, {}).expect(400);

    expect(refused.body).toMatchObject({
      code: 'INVALID_STEP_DATA',
      errors: { selectedAccounts: ['NO_ACCOUNTS_SELECTED'] },
    });
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'credit_check',
      pendingConnector: null,
    });
  });

  it('reports data_unavailable, stores nothing and routes to review when Lean refuses the accounts read', async () => {
    lean.refuse.add('accounts');
    const onboardingId = await connectBank();

    const settled = await readOnboarding(onboardingId);
    expect(settled.currentStep).toBe('bank_data_gate');
    expect(settled.context).toMatchObject({ bankConnectOutcome: 'data_unavailable' });
    expect(settled.context[EXPORT_FIELD]).toBeUndefined();
    expect(settled.context.salaryMonthlyAverage).toBeUndefined();

    await submitOk(onboardingId, {});
    await expect(readOnboarding(onboardingId)).resolves.toMatchObject({
      currentStep: 'manual_review',
    });
    const documents: unknown[] = await dataSource.query(
      'SELECT id FROM onboarding_documents WHERE onboarding_id = $1',
      [onboardingId],
    );
    expect(documents).toEqual([]);
  });
});
