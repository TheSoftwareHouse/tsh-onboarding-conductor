import { ConnectorDocumentTooLargeError } from '../../../documents/connector-document-too-large.error';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import { LeanUnavailableException } from '../../../errors/lean-unavailable.exception';
import { PendingConnectorReconcileUnsupportedException } from '../../../errors/pending-connector-reconcile-unsupported.exception';
import type { ConnectorExecutionInput } from '../../../ports/connector-adapter.port';
import { ConnectorExecutionMetadataFlag } from '../../../ports/connector-execution-result';
import { LeanBankDataConnector } from './lean-bank-data.connector';
import {
  LEAN_CONNECT_ABANDONED_AFTER_MS,
  LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER,
  LEAN_EVENT_ENTITY_CREATED,
  LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED,
} from './lean-contract';

const ONBOARDING_ID = '33333333-3333-4333-8333-333333333333';
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_CUSTOMER_ID = '44444444-4444-4444-8444-444444444444';
const ENTITY_ID = '11111111-1111-4111-8111-111111111111';
const DOCUMENT_ID = '55555555-5555-4555-8555-555555555555';
const PARKED_AT_MS = Date.parse('2026-10-13T10:00:00.000Z');
const MIN_MONTHLY_SALARY = 4000;
const DECLARATION_CONFIG = { minMonthlySalary: MIN_MONTHLY_SALARY };
const CREDENTIALS = { clientId: 'client-id-1', clientSecret: 'client-secret-1' };

const RETRYABLE_INVALID_DATA = { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true };

const forbiddenCustomer = {
  kind: 'error' as const,
  httpStatus: 403,
  body: { status: 'FORBIDDEN', message: 'no' },
};

const encode = (body: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(body));

const entityCreated = (appUserId = ONBOARDING_ID, customerId = CUSTOMER_ID) =>
  encode({
    type: LEAN_EVENT_ENTITY_CREATED,
    payload: { id: ENTITY_ID, app_user_id: appUserId, customer_id: customerId },
  });

const refreshUpdated = (
  status: string,
  dataStatus: unknown = { accounts: 'SUCCESS', account_data: [{ transactions: 'SUCCESS' }] },
  customerId = CUSTOMER_ID,
) =>
  encode({
    type: LEAN_EVENT_ENTITY_DATA_REFRESH_UPDATED,
    payload: {
      refresh_id: 'refresh-1',
      entity_id: ENTITY_ID,
      customer_id: customerId,
      status,
      data_status: dataStatus,
    },
  });

const okResult = <T>(body: T) => ({ kind: 'ok' as const, body });

const customerOf = (appUserId: string, customerId = CUSTOMER_ID) =>
  okResult({ customer_id: customerId, app_user_id: appUserId });

const incomeBody = okResult({
  status: 'OK',
  results_id: 'results-1',
  insights: {
    salary: {
      currency: 'SAR',
      total: { amount: 18000, count: 3, average_monthly_amount: 6000 },
      monthly_totals: [
        { month: 8, year: 2026, amount: 6000, count: 1 },
        { month: 9, year: 2026, amount: 6000, count: 1 },
        { month: 10, year: 2026, amount: 0, count: 0 },
      ],
    },
    non_salary: {
      currency: 'SAR',
      total: { amount: 700, count: 2, average_monthly_amount: 350 },
      monthly_totals: [],
    },
  },
});

const employmentBody = okResult({
  status: 'OK',
  results_id: 'results-2',
  insights: {
    employment_details: [
      {
        bank_employer_name: 'ACME KSA',
        matched_reference_employer: { name: { en: 'Acme Arabia', ar: 'أكمي' }, cr_number: 1 },
        salary_consistent: true,
      },
    ],
  },
});

const CONNECTED_FIELDS = {
  bankConnectOutcome: 'connected',
  salaryMonthlyAverage: 6000,
  salaryMonthsDetected: 2,
  nonSalaryMonthlyAverage: 350,
  salaryConsistent: true,
  salaryThresholdMet: true,
  employerName: 'Acme Arabia',
};

const pendingInsights = {
  kind: 'pending' as const,
  body: { status: 'PENDING', results_id: 'r', message: 'computing' },
};
const unsupportedInsights = {
  kind: 'unsupported' as const,
  body: { status: 'NOT_IMPLEMENTED', message: 'bank cannot serve sync' },
};

const createDeps = (
  parkedReference: string | null = CUSTOMER_ID,
  config: object = DECLARATION_CONFIG,
) => {
  const settings = {
    find: jest.fn(),
    get: jest.fn((key: string) =>
      key === 'clientId' ? CREDENTIALS.clientId : CREDENTIALS.clientSecret,
    ),
  };
  const pendingConnector = {
    connectorName: 'lean_bank_data',
    connectorId: 'lean_bank_data',
    connectorOrder: 2,
    providerReference: parkedReference ?? undefined,
    parkedAt: new Date(PARKED_AT_MS).toISOString(),
  };

  return {
    leanClient: {
      getCustomer: jest.fn().mockResolvedValue(customerOf(ONBOARDING_ID)),
      listCustomerEntities: jest.fn(),
      getIncome: jest.fn().mockResolvedValue(incomeBody),
      getEmployment: jest.fn().mockResolvedValue(employmentBody),
      listAccounts: jest.fn(),
      listBalances: jest.fn(),
      listTransactions: jest.fn(),
    },
    connectorDocumentStore: {
      store: jest.fn().mockResolvedValue({ documentId: DOCUMENT_ID, sizeBytes: 123 }),
    },
    connectorSettingsService: { resolve: jest.fn().mockResolvedValue(settings) },
    awaitingCallbackConnectorResolver: {
      findConnector: jest.fn().mockResolvedValue({
        connectorOrder: 2,
        onboarding: { id: ONBOARDING_ID, currentStep: 'bank_connect', context: {} },
        connector: { id: 'lean_bank_data', order: 2, config, fieldMapping: {} },
        pendingConnector,
      }),
    },
    pendingConnector,
  };
};

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new LeanBankDataConnector(
    deps.leanClient as never,
    deps.connectorSettingsService as never,
    deps.awaitingCallbackConnectorResolver as never,
    deps.connectorDocumentStore as never,
  );

const EXPORT_FIELD = 'bankDataDocument';
const EXPORT_CONFIG = { ...DECLARATION_CONFIG, exportField: EXPORT_FIELD };

const leanEntity = (id = ENTITY_ID, bankIdentifier = 'LEA1_SAMAOB_SAU') => ({
  id,
  customer_id: CUSTOMER_ID,
  bank_identifier: bankIdentifier,
  bank_details: { name: 'Mockbank 1', identifier: bankIdentifier },
  created_at: '2026-10-13T10:20:00Z',
});

const leanAccount = (accountId: string, overrides: Record<string, unknown> = {}) => ({
  account_id: accountId,
  account_holder_name: 'Inventory User',
  currency: 'SAR',
  account_type: 'PERSONAL',
  account_sub_type: 'CURRENT',
  status: 'ACTIVE',
  account: [{ scheme_name: 'IBAN', identification: `SA00${accountId}1309` }],
  ...overrides,
});

const leanTransaction = (amount: number) => ({
  amount: { amount, currency: 'SAR' },
  credit_debit_indicator: 'CREDIT',
  status: 'BOOKED',
  booking_date_time: '2026-09-25T00:00:00Z',
  transaction_information: 'PAYROLL PAYMENT',
});

/** Wires the data API answers for one current account and one USD account the export must skip. */
const stubExport = (deps: ReturnType<typeof createDeps>) => {
  deps.leanClient.listCustomerEntities.mockResolvedValue(okResult([leanEntity()]));
  deps.leanClient.listAccounts.mockResolvedValue(
    okResult({
      data: { accounts: [leanAccount('cur'), leanAccount('usd', { currency: 'USD' })] },
    }),
  );
  deps.leanClient.listBalances.mockResolvedValue(
    okResult({
      data: {
        balances: [
          {
            type: 'INTERIM_AVAILABLE',
            credit_debit_indicator: 'CREDIT',
            amount: { amount: 1000, currency: 'SAR' },
            date_time: '2026-10-18T00:00:00Z',
          },
        ],
      },
    }),
  );
  deps.leanClient.listTransactions.mockResolvedValue(
    okResult({ data: { transactions: [leanTransaction(30000)], page: { total_pages: 1 } } }),
  );
};

const executionInput = (
  payload: Record<string, unknown> = { leanCustomerId: CUSTOMER_ID },
): ConnectorExecutionInput => ({
  declaration: { order: 2, config: DECLARATION_CONFIG, async: true },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'bank_connect' },
  context: {},
  payload,
  payloadFieldSources: { leanCustomerId: 'leanCustomerId' },
});

describe('LeanBankDataConnector', () => {
  describe('declaration', () => {
    it('is an async credit connector signed with HMAC-SHA512 over the lean-signature header', () => {
      const connector = createConnector(createDeps());

      expect(connector).toMatchObject({
        id: 'lean_bank_data',
        type: 'credit',
        supportsAsyncCallback: true,
        callbackAuth: {
          kind: 'hmac',
          algorithm: 'sha512',
          signatureHeader: 'lean-signature',
          encoding: 'hex',
        },
      });
      expect(connector.callbackFields).toEqual([
        'bankConnectOutcome',
        'salaryMonthlyAverage',
        'salaryMonthsDetected',
        'nonSalaryMonthlyAverage',
        'salaryConsistent',
        'employerName',
        'salaryThresholdMet',
      ]);
      expect(connector.settingsSchema.fields.map((field) => field.key)).toEqual([
        'clientId',
        'clientSecret',
        'callbackSigningSecret',
      ]);
    });

    it('strips the sha512= prefix case-insensitively', () => {
      const { parseSignatureHeader } = createConnector(createDeps()).callbackAuth;

      expect(parseSignatureHeader?.('sha512=abc')).toEqual(['abc']);
      expect(parseSignatureHeader?.('SHA512=abc')).toEqual(['abc']);
    });
  });

  describe('validateDeclaration', () => {
    const declare = (config: Record<string, unknown>) =>
      createConnector(createDeps()).validateDeclaration({
        id: 'lean_bank_data',
        type: 'credit',
        order: 2,
        config,
        fieldMapping: { leanCustomerId: 'leanCustomerId' },
      } as never);

    it('accepts a positive minMonthlySalary', () => {
      expect(() => declare({ minMonthlySalary: 4000 })).not.toThrow();
    });

    it.each([
      ['missing', {}],
      ['zero', { minMonthlySalary: 0 }],
      ['negative', { minMonthlySalary: -1 }],
      ['not finite', { minMonthlySalary: Infinity }],
      ['not a number', { minMonthlySalary: '4000' }],
    ])('refuses a minMonthlySalary that is %s', (_label, config) => {
      expect(() => declare(config)).toThrow('minMonthlySalary');
    });

    it('accepts an exportField naming a field, and refuses one that names nothing', () => {
      expect(() => declare(EXPORT_CONFIG)).not.toThrow();
      expect(() => declare({ ...DECLARATION_CONFIG, exportField: '' })).toThrow('exportField');
      expect(() => declare({ ...DECLARATION_CONFIG, exportField: 7 })).toThrow('exportField');
    });
  });

  describe('export', () => {
    const callback = (rawBody: Uint8Array) => ({ rawBody, headers: {} });

    it('reads nothing from the data API when the declaration names no exportField', async () => {
      const deps = createDeps();

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.submittedData).toEqual(CONNECTED_FIELDS);
      expect(deps.leanClient.listAccounts).not.toHaveBeenCalled();
      expect(deps.connectorDocumentStore.store).not.toHaveBeenCalled();
    });

    it('stores the converted document under the export field and summarises the accounts', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.submittedData).toEqual({
        ...CONNECTED_FIELDS,
        [EXPORT_FIELD]: DOCUMENT_ID,
        bankAccounts: {
          accounts: [
            {
              id: 'account-01',
              type: 'CHECKING',
              name: 'Current account',
              accountNumber: '1309',
              balance: 197,
              currency: 'GBP',
              bankName: 'Mockbank 1',
            },
          ],
        },
      });
      // The USD account is skipped before any read of its balances or transactions.
      expect(deps.leanClient.listBalances).toHaveBeenCalledTimes(1);
      expect(deps.leanClient.listTransactions).toHaveBeenCalledWith(
        CREDENTIALS,
        expect.objectContaining({ entityId: ENTITY_ID, accountId: 'cur', page: 0 }),
      );
      expect(deps.connectorDocumentStore.store).toHaveBeenCalledWith({
        connectorId: 'lean_bank_data',
        onboardingId: ONBOARDING_ID,
        stepName: 'bank_connect',
        fieldName: EXPORT_FIELD,
        contentType: 'application/json',
        body: expect.any(Buffer),
      });
      const document = JSON.parse(
        (deps.connectorDocumentStore.store.mock.calls[0][0] as { body: Buffer }).body.toString(),
      ) as { accounts: Array<Record<string, unknown>> };
      expect(document.accounts).toHaveLength(1);
      expect(document.accounts[0]).toMatchObject({
        type: 'CHECKING',
        usage: 'PERSONAL',
        currency: 'GBP',
        balance: 197,
        bank: { id: 'LEA1_SAMAOB_SAU', name: 'Mockbank 1' },
        transactions: [expect.objectContaining({ amount: 5910, currency: 'GBP' })],
      });
    });

    it('pages transactions until a short page or the last page', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);
      const fullPage = Array.from({ length: 100 }, () => leanTransaction(10));
      deps.leanClient.listTransactions
        .mockResolvedValueOnce(
          okResult({ data: { transactions: fullPage, page: { total_pages: 3 } } }),
        )
        .mockResolvedValueOnce(
          okResult({ data: { transactions: fullPage, page: { total_pages: 3 } } }),
        )
        .mockResolvedValueOnce(okResult({ data: { transactions: [leanTransaction(10)] } }));

      await createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED')));

      expect(deps.leanClient.listTransactions).toHaveBeenCalledTimes(3);
      expect(
        deps.leanClient.listTransactions.mock.calls.map(([, request]) => request.page),
      ).toEqual([0, 1, 2]);
    });

    it.each([
      ['entities', 'listCustomerEntities'],
      ['accounts', 'listAccounts'],
      ['balances', 'listBalances'],
      ['transactions', 'listTransactions'],
    ] as const)(
      'reports data_unavailable when Lean refuses the %s read',
      async (_label, method) => {
        const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
        stubExport(deps);
        deps.leanClient[method].mockResolvedValue(forbiddenCustomer);

        const mapped = await createConnector(deps).mapCallbackResult(
          callback(refreshUpdated('FINISHED')),
        );

        expect(mapped.submittedData).toEqual({ bankConnectOutcome: 'data_unavailable' });
        expect(deps.connectorDocumentStore.store).not.toHaveBeenCalled();
      },
    );

    it('reports data_unavailable when no account can be exported', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);
      deps.leanClient.listAccounts.mockResolvedValue(
        okResult({ data: { accounts: [leanAccount('usd', { currency: 'USD' })] } }),
      );

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.submittedData).toEqual({ bankConnectOutcome: 'data_unavailable' });
    });

    it('reports data_unavailable when the document is over the store cap', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);
      deps.connectorDocumentStore.store.mockRejectedValue(
        new ConnectorDocumentTooLargeError('lean_bank_data', 2, 1),
      );

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.submittedData).toEqual({ bankConnectOutcome: 'data_unavailable' });
    });

    it('lets a storage failure surface rather than deciding on it', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);
      deps.connectorDocumentStore.store.mockRejectedValue(new Error('storage down'));

      await expect(
        createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED'))),
      ).rejects.toThrow('storage down');
    });

    it('exports on reconcile too, for the newest entity', async () => {
      const deps = createDeps(CUSTOMER_ID, EXPORT_CONFIG);
      stubExport(deps);

      const reconciled = await createConnector(deps).reconcilePending({
        onboardingId: ONBOARDING_ID,
      });

      expect(reconciled).toMatchObject({
        outcome: 'resolved',
        callback: {
          submittedData: expect.objectContaining({
            bankConnectOutcome: 'connected',
            [EXPORT_FIELD]: DOCUMENT_ID,
          }),
        },
      });
    });
  });

  describe('execute', () => {
    it('accepts a customer created for this onboarding and reports it as the park reference', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).execute(executionInput());

      expect(result.isAccepted()).toBe(true);
      expect(result.metadata).toEqual({ providerReference: CUSTOMER_ID });
      expect(deps.leanClient.getCustomer).toHaveBeenCalledWith(CREDENTIALS, CUSTOMER_ID);
    });

    it('refuses a customer created for another onboarding', async () => {
      const deps = createDeps();
      deps.leanClient.getCustomer.mockResolvedValue(customerOf('another-onboarding'));

      const result = await createConnector(deps).execute(executionInput());

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toHaveProperty('leanCustomerId');
      expect(result.metadata).toEqual(RETRYABLE_INVALID_DATA);
    });

    it('refuses a customer Lean does not know', async () => {
      const deps = createDeps();
      deps.leanClient.getCustomer.mockResolvedValue({
        kind: 'error',
        httpStatus: 404,
        body: { status: LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER, message: 'unknown' },
      });

      const result = await createConnector(deps).execute(executionInput());

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toHaveProperty('leanCustomerId');
      expect(result.metadata).toEqual(RETRYABLE_INVALID_DATA);
    });

    it('refuses a customer id that is not a UUID without calling Lean', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).execute(
        executionInput({ leanCustomerId: 'not-a-uuid' }),
      );

      expect(result.isInvalidData()).toBe(true);
      expect(result.errors).toHaveProperty('leanCustomerId');
      expect(result.metadata).toEqual(RETRYABLE_INVALID_DATA);
      expect(deps.leanClient.getCustomer).not.toHaveBeenCalled();
    });

    it('refuses a missing customer id without calling Lean', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).execute(executionInput({}));

      expect(result.isInvalidData()).toBe(true);
      expect(result.metadata).toEqual(RETRYABLE_INVALID_DATA);
      expect(deps.leanClient.getCustomer).not.toHaveBeenCalled();
    });

    it.each([
      ['forbidden', forbiddenCustomer],
      [
        'rate limited',
        {
          kind: 'error' as const,
          httpStatus: 429,
          body: { status: 'TOO_MANY_REQUESTS', message: '' },
        },
      ],
      [
        'a 404 that is not UNKNOWN_CUSTOMER',
        {
          kind: 'error' as const,
          httpStatus: 404,
          body: { status: 'INVALID_URL', message: '' },
        },
      ],
    ])(
      'treats a customer lookup that is %s as an integration failure, not an invalid customer',
      async (_label, answer) => {
        const deps = createDeps();
        deps.leanClient.getCustomer.mockResolvedValue(answer);

        await expect(createConnector(deps).execute(executionInput())).rejects.toBeInstanceOf(
          LeanUnavailableException,
        );
      },
    );

    it('lets an unreachable Lean surface as an integration failure', async () => {
      const deps = createDeps();
      deps.leanClient.getCustomer.mockRejectedValue(new LeanUnavailableException());

      await expect(createConnector(deps).execute(executionInput())).rejects.toBeInstanceOf(
        LeanUnavailableException,
      );
    });
  });

  describe('mapCallbackResult', () => {
    const callback = (rawBody: Uint8Array) => ({ rawBody, headers: {} });

    it.each([
      ['entity.created', entityCreated()],
      ['a PENDING refresh', refreshUpdated('PENDING')],
    ])('re-parks on %s, keeping the stored park', async (_label, rawBody) => {
      const deps = createDeps();

      const mapped = await createConnector(deps).mapCallbackResult(callback(rawBody));

      expect(mapped.onboardingId).toBe(ONBOARDING_ID);
      expect(mapped.submittedData).toEqual({});
      expect(mapped.result.isPending()).toBe(true);
      expect(mapped.result.pending).toEqual(deps.pendingConnector);
      expect(deps.leanClient.getIncome).not.toHaveBeenCalled();
    });

    it('reads the onboarding back from the customer for a refresh event', async () => {
      const deps = createDeps();

      await createConnector(deps).mapCallbackResult(callback(refreshUpdated('PENDING')));

      expect(deps.leanClient.getCustomer).toHaveBeenCalledWith(CREDENTIALS, CUSTOMER_ID);
      expect(deps.awaitingCallbackConnectorResolver.findConnector).toHaveBeenCalledWith({
        onboardingId: ONBOARDING_ID,
        connectorId: 'lean_bank_data',
      });
    });

    it('emits every callback field for a FINISHED refresh with usable data', async () => {
      const deps = createDeps();

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.result.isAccepted()).toBe(true);
      expect(mapped.submittedData).toEqual(CONNECTED_FIELDS);
      expect(deps.leanClient.getIncome).toHaveBeenCalledWith(CREDENTIALS, {
        entityId: ENTITY_ID,
        startDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      });
      expect(deps.leanClient.getEmployment).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['below', 6001, false],
      ['at', 6000, true],
      ['above', 5999, true],
    ])(
      'sets salaryThresholdMet from the declaration config: average 6000 %s the threshold',
      async (_label, minMonthlySalary, met) => {
        const deps = createDeps(CUSTOMER_ID, { minMonthlySalary });

        const mapped = await createConnector(deps).mapCallbackResult(
          callback(refreshUpdated('FINISHED')),
        );

        expect(mapped.submittedData).toMatchObject({ salaryThresholdMet: met });
      },
    );

    it('fails loudly when the parked declaration carries no usable threshold', async () => {
      const deps = createDeps(CUSTOMER_ID, {});

      await expect(
        createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED'))),
      ).rejects.toThrow('minMonthlySalary');
    });

    it.each([
      ['failed transactions', { accounts: 'SUCCESS', account_data: [{ transactions: 'FAILED' }] }],
      [
        'unsupported transactions',
        { accounts: 'SUCCESS', account_data: [{ transactions: 'UNSUPPORTED' }] },
      ],
    ])('reports data_unavailable for a FINISHED refresh with %s', async (_label, dataStatus) => {
      const deps = createDeps();

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED', dataStatus)),
      );

      expect(mapped.result.isAccepted()).toBe(true);
      expect(mapped.submittedData).toEqual({ bankConnectOutcome: 'data_unavailable' });
      expect(mapped.submittedData).not.toHaveProperty('salaryThresholdMet');
      expect(deps.leanClient.getIncome).not.toHaveBeenCalled();
    });

    it('reports data_unavailable when Lean refuses the insights request', async () => {
      const deps = createDeps();
      deps.leanClient.getIncome.mockResolvedValue({
        kind: 'error',
        httpStatus: 400,
        body: { status: 'INVALID_PARAMETERS', message: 'bad' },
      });

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.submittedData).toEqual({ bankConnectOutcome: 'data_unavailable' });
      expect(deps.leanClient.getEmployment).not.toHaveBeenCalled();
    });

    it.each([
      ['income still computing', 'getIncome', pendingInsights],
      ['income unsupported synchronously', 'getIncome', unsupportedInsights],
      ['employment still computing', 'getEmployment', pendingInsights],
      ['employment unsupported synchronously', 'getEmployment', unsupportedInsights],
    ] as const)('re-parks a FINISHED refresh when %s', async (_label, call, answer) => {
      const deps = createDeps();
      deps.leanClient[call].mockResolvedValue(answer);

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.result.isPending()).toBe(true);
      expect(mapped.submittedData).toEqual({});
      expect(mapped.result.pending).toEqual(deps.pendingConnector);
    });

    it.each([
      ['an unrelated event type', encode({ type: 'bank.availability.updated', payload: {} })],
      ['a body that is not JSON', new TextEncoder().encode('{')],
      ['an app_user_id that is not a UUID', entityCreated('not-a-uuid')],
    ])('acknowledges %s as already applied', async (_label, rawBody) => {
      const deps = createDeps();

      await expect(
        createConnector(deps).mapCallbackResult(callback(rawBody)),
      ).rejects.toBeInstanceOf(ConnectorCallbackAlreadyAppliedError);
      expect(deps.awaitingCallbackConnectorResolver.findConnector).not.toHaveBeenCalled();
    });

    it('acknowledges a refresh for a customer Lean cannot map to an onboarding', async () => {
      const deps = createDeps();
      deps.leanClient.getCustomer.mockResolvedValue({
        kind: 'error',
        httpStatus: 404,
        body: { status: LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER, message: 'unknown' },
      });

      await expect(
        createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED'))),
      ).rejects.toBeInstanceOf(ConnectorCallbackAlreadyAppliedError);
    });

    it.each([
      ['forbidden', forbiddenCustomer],
      [
        'rate limited',
        {
          kind: 'error' as const,
          httpStatus: 429,
          body: { status: 'TOO_MANY_REQUESTS', message: '' },
        },
      ],
    ])(
      'fails the webhook, so Lean retries it, when the customer lookup is %s',
      async (_label, answer) => {
        const deps = createDeps();
        deps.leanClient.getCustomer.mockResolvedValue(answer);

        await expect(
          createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED'))),
        ).rejects.toBeInstanceOf(LeanUnavailableException);
        expect(deps.awaitingCallbackConnectorResolver.findConnector).not.toHaveBeenCalled();
      },
    );

    it('acknowledges a callback for an onboarding that is not parked', async () => {
      const deps = createDeps();
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);

      await expect(
        createConnector(deps).mapCallbackResult(callback(refreshUpdated('FINISHED'))),
      ).rejects.toBeInstanceOf(ConnectorCallbackAlreadyAppliedError);
      expect(deps.leanClient.getIncome).not.toHaveBeenCalled();
    });

    it('treats a customer other than the parked one as superseded: re-park, nothing decided', async () => {
      const deps = createDeps(OTHER_CUSTOMER_ID);

      const mapped = await createConnector(deps).mapCallbackResult(
        callback(refreshUpdated('FINISHED')),
      );

      expect(mapped.result.isPending()).toBe(true);
      expect(mapped.submittedData).toEqual({});
      expect(mapped.result.pending).toEqual(deps.pendingConnector);
      expect(deps.leanClient.getIncome).not.toHaveBeenCalled();
    });
  });

  describe('reconcilePending', () => {
    const input = { onboardingId: ONBOARDING_ID };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const setNow = (offsetMs: number) =>
      jest.spyOn(Date, 'now').mockReturnValue(PARKED_AT_MS + offsetMs);

    it('stays pending while a young park has no entity', async () => {
      const deps = createDeps();
      deps.leanClient.listCustomerEntities.mockResolvedValue(okResult([]));
      setNow(LEAN_CONNECT_ABANDONED_AFTER_MS - 1);

      await expect(createConnector(deps).reconcilePending(input)).resolves.toEqual({
        outcome: 'still_pending',
      });
      expect(deps.leanClient.listCustomerEntities).toHaveBeenCalledWith(CREDENTIALS, CUSTOMER_ID);
    });

    it('resolves not_connected when an old park has no entity', async () => {
      const deps = createDeps();
      deps.leanClient.listCustomerEntities.mockResolvedValue(okResult([]));
      setNow(LEAN_CONNECT_ABANDONED_AFTER_MS);

      const reconciled = await createConnector(deps).reconcilePending(input);

      expect(reconciled).toMatchObject({
        outcome: 'resolved',
        callback: {
          onboardingId: ONBOARDING_ID,
          submittedData: { bankConnectOutcome: 'not_connected' },
        },
      });
      expect(reconciled.outcome === 'resolved' && reconciled.callback.result.isAccepted()).toBe(
        true,
      );
      expect(reconciled.outcome === 'resolved' && reconciled.callback.submittedData).toEqual({
        bankConnectOutcome: 'not_connected',
      });
    });

    it('resolves with the insights of the newest entity', async () => {
      const deps = createDeps();
      deps.leanClient.listCustomerEntities.mockResolvedValue(
        okResult([
          {
            id: 'older-entity',
            customer_id: CUSTOMER_ID,
            bank_identifier: 'LEA1',
            created_at: '2026-10-13T10:05:00Z',
          },
          {
            id: ENTITY_ID,
            customer_id: CUSTOMER_ID,
            bank_identifier: 'LEA2',
            created_at: '2026-10-13T10:20:00Z',
          },
        ]),
      );

      const reconciled = await createConnector(deps).reconcilePending(input);

      expect(reconciled).toMatchObject({
        outcome: 'resolved',
        callback: { onboardingId: ONBOARDING_ID, submittedData: CONNECTED_FIELDS },
      });
      expect(deps.leanClient.getIncome).toHaveBeenCalledWith(
        CREDENTIALS,
        expect.objectContaining({ entityId: ENTITY_ID }),
      );
    });

    it('computes salaryThresholdMet on reconcile from the parked declaration config', async () => {
      const deps = createDeps(CUSTOMER_ID, { minMonthlySalary: 6001 });
      deps.leanClient.listCustomerEntities.mockResolvedValue(
        okResult([
          {
            id: ENTITY_ID,
            customer_id: CUSTOMER_ID,
            bank_identifier: 'LEA1',
            created_at: '2026-10-13T10:05:00Z',
          },
        ]),
      );

      await expect(createConnector(deps).reconcilePending(input)).resolves.toMatchObject({
        outcome: 'resolved',
        callback: { submittedData: { salaryThresholdMet: false, salaryMonthlyAverage: 6000 } },
      });
    });

    it('stays pending while the insights of a connected entity are still computing', async () => {
      const deps = createDeps();
      deps.leanClient.listCustomerEntities.mockResolvedValue(
        okResult([
          {
            id: ENTITY_ID,
            customer_id: CUSTOMER_ID,
            bank_identifier: 'LEA1',
            created_at: '2026-10-13T10:05:00Z',
          },
        ]),
      );
      deps.leanClient.getIncome.mockResolvedValue(pendingInsights);

      await expect(createConnector(deps).reconcilePending(input)).resolves.toEqual({
        outcome: 'still_pending',
      });
    });

    it.each([
      ['income', 'getIncome'],
      ['employment', 'getEmployment'],
    ] as const)(
      'resolves data_unavailable when %s is unsupported synchronously',
      async (_label, call) => {
        const deps = createDeps();
        deps.leanClient.listCustomerEntities.mockResolvedValue(
          okResult([
            {
              id: ENTITY_ID,
              customer_id: CUSTOMER_ID,
              bank_identifier: 'LEA1',
              created_at: '2026-10-13T10:05:00Z',
            },
          ]),
        );
        deps.leanClient[call].mockResolvedValue(unsupportedInsights);

        const reconciled = await createConnector(deps).reconcilePending(input);

        expect(reconciled).toMatchObject({
          outcome: 'resolved',
          callback: {
            onboardingId: ONBOARDING_ID,
            submittedData: { bankConnectOutcome: 'data_unavailable' },
          },
        });
        expect(reconciled.outcome === 'resolved' && reconciled.callback.result.isAccepted()).toBe(
          true,
        );
      },
    );

    it('decides nothing on an entity listing Lean refuses', async () => {
      const deps = createDeps();
      deps.leanClient.listCustomerEntities.mockResolvedValue({
        kind: 'error',
        httpStatus: 404,
        body: { status: LEAN_ERROR_STATUS_UNKNOWN_CUSTOMER, message: 'unknown' },
      });
      setNow(LEAN_CONNECT_ABANDONED_AFTER_MS * 2);

      await expect(createConnector(deps).reconcilePending(input)).resolves.toEqual({
        outcome: 'still_pending',
      });
    });

    it('reports an onboarding no longer parked as already applied', async () => {
      const deps = createDeps();
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);

      await expect(createConnector(deps).reconcilePending(input)).rejects.toBeInstanceOf(
        ConnectorCallbackAlreadyAppliedError,
      );
    });

    it('refuses a park that records no Lean customer', async () => {
      const deps = createDeps(null);

      await expect(createConnector(deps).reconcilePending(input)).rejects.toBeInstanceOf(
        PendingConnectorReconcileUnsupportedException,
      );
      expect(deps.leanClient.listCustomerEntities).not.toHaveBeenCalled();
    });
  });
});
