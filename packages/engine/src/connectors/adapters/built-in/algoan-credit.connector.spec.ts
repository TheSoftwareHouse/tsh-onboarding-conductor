import { ConnectorCallbackAlreadyAppliedError } from '../../errors/connector-callback-already-applied.error';
import { ConnectorExecutionResult } from '../../ports/connector-execution-result';
import type {
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../../ports/connector-adapter.port';
import { AlgoanCreditConnector } from './algoan-credit.connector';
import type { AlgoanClient } from './algoan-credit/algoan-client';
import { AlgoanCreditProvider } from './algoan-credit/algoan-credit.provider';

// The seam between the credit kernel and the Algoan provider, driven with a mocked `AlgoanClient`.
// The kernel's rules live in `credit/credit-connector.spec.ts`, the wire mapping in
// `algoan-credit/algoan-credit.provider.spec.ts`; this file pins what neither sees alone.

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';

const CONFIG: Readonly<Record<string, unknown>> = {
  bands: { approveFrom: 700, reviewFrom: 400 },
  maxAttempts: 2,
};

const account = (overrides: Record<string, unknown> = {}) => ({
  type: 'CHECKING',
  usage: 'PERSONAL',
  currency: 'GBP',
  balance: 10,
  balanceDate: '2026-10-15',
  bank: { name: 'Bank' },
  ...overrides,
});

const createInput = (): ConnectorExecutionInput => ({
  declaration: { order: 1, config: CONFIG },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'credit' },
  context: {},
  payload: { bankData: 'document-1' },
  payloadFieldSources: { bankData: 'bankData' },
});

const callback = (eventName: string): ConnectorCallbackMappingInput => ({
  rawBody: new TextEncoder().encode(
    JSON.stringify({
      subscription: { eventName },
      payload: { customerId: 'cust-1', analysisId: 'ana-1' },
    }),
  ),
  headers: {},
});

const createDeps = (accounts: unknown[] = [account()]) => {
  const algoanClient = {
    createCustomer: jest.fn().mockResolvedValue({ id: 'cust-1', customIdentifier: ONBOARDING_ID }),
    getCustomer: jest.fn().mockResolvedValue({ id: 'cust-1', customIdentifier: ONBOARDING_ID }),
    createAnalysis: jest.fn().mockResolvedValue({ id: 'ana-1', status: 'CREATED' }),
    getAnalysis: jest.fn().mockResolvedValue({ id: 'ana-1', status: 'COMPLETED' }),
    getScores: jest.fn().mockResolvedValue({
      creditScore: { value: 965, version: '1.0.0', indicators: { livingStandard: 3 } },
      paymentScore: { value: 10, version: '1.1.0' },
    }),
    getEssentials: jest.fn().mockResolvedValue({}),
    getCreditInsights: jest.fn().mockResolvedValue({}),
    listAccounts: jest.fn().mockResolvedValue({ resources: [] }),
    listTransactions: jest.fn().mockResolvedValue({ resources: [] }),
  };
  const settings = {
    find: jest.fn(),
    get: (key: string) =>
      ({ clientId: 'client-1', clientSecret: 'secret-1', callbackSigningSecret: 's' })[key],
  };

  return {
    algoanClient,
    connectorSettingsService: { resolve: jest.fn().mockResolvedValue(settings) },
    documentResolver: {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'key',
        verifiedEtag: '"etag"',
        verifiedSizeBytes: 2,
        contentType: 'application/json',
      }),
    },
    objectStoragePort: {
      readObject: jest.fn().mockResolvedValue(Buffer.from(JSON.stringify({ accounts }))),
    },
    awaitingCallbackConnectorResolver: {
      findConnector: jest.fn().mockResolvedValue({
        connectorOrder: 1,
        onboarding: { id: ONBOARDING_ID, currentStep: 'credit', context: {} },
        connector: { id: 'algoan_credit', order: 1, config: CONFIG, fieldMapping: {} },
        pendingConnector: {
          connectorName: 'algoan_credit',
          connectorId: 'algoan_credit',
          connectorOrder: 1,
          providerReference: 'cust-1/ana-1',
          parkedAt: '2026-10-15T10:00:00.000Z',
        },
      }),
    },
  };
};

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new AlgoanCreditConnector(
    new AlgoanCreditProvider(deps.algoanClient as unknown as AlgoanClient),
    deps.connectorSettingsService as never,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
    deps.awaitingCallbackConnectorResolver as never,
  );

describe('AlgoanCreditConnector', () => {
  it('declares algoan_credit as a signed, callback-capable credit connector', () => {
    expect(createConnector(createDeps())).toMatchObject({
      id: 'algoan_credit',
      type: 'credit',
      supportsAsyncCallback: true,
      callbackAuth: {
        kind: 'hmac',
        algorithm: 'sha256',
        signatureHeader: 'X-Hub-Signature',
        encoding: 'hex',
      },
    });
  });

  it('parks on customerId/analysisId after creating the analysis', async () => {
    const deps = createDeps();

    const result = await createConnector(deps).execute(createInput());

    expect(result).toEqual(
      ConnectorExecutionResult.accepted({ providerReference: 'cust-1/ana-1' }),
    );
    expect(deps.algoanClient.createCustomer).toHaveBeenCalledWith(
      { clientId: 'client-1', clientSecret: 'secret-1' },
      ONBOARDING_ID,
    );
  });

  it('answers the client a bank-data field error when the step currency has no account', async () => {
    const deps = createDeps([account({ currency: 'EUR' })]);

    const result = await createConnector(deps).execute(createInput());

    expect(result).toEqual(
      expect.objectContaining({ errors: { bankData: ['INVALID_BANK_DATA'] } }),
    );
    expect(deps.algoanClient.createCustomer).not.toHaveBeenCalled();
  });

  it('scores an analysis_completed callback by reading the result back from Algoan', async () => {
    const deps = createDeps();

    const { submittedData, result } = await createConnector(deps).mapCallbackResult(
      callback('analysis_completed'),
    );

    expect(result).toEqual(ConnectorExecutionResult.accepted());
    expect(submittedData).toMatchObject({
      creditOutcome: 'approved',
      creditScore: 965,
      creditProviderReference: 'cust-1/ana-1',
    });
  });

  it('turns an analysis_failed callback into the failed outcome with Algoan code', async () => {
    const deps = createDeps();
    deps.algoanClient.getAnalysis.mockResolvedValue({
      id: 'ana-1',
      status: 'ERROR',
      error: { code: 'NO_CHECKING_ACCOUNT', message: 'm' },
    });

    const { submittedData } = await createConnector(deps).mapCallbackResult(
      callback('analysis_failed'),
    );

    expect(submittedData).toMatchObject({ creditReasonCodes: ['NO_CHECKING_ACCOUNT'] });
  });

  it('acts on nothing for an event outside analysis_completed and analysis_failed', async () => {
    const deps = createDeps();

    // The event names no onboarding, so the webhook ingress acknowledges it as already applied.
    await expect(
      createConnector(deps).mapCallbackResult(callback('bank_details_fetched')),
    ).rejects.toBeInstanceOf(ConnectorCallbackAlreadyAppliedError);
    expect(deps.algoanClient.getAnalysis).not.toHaveBeenCalled();
  });
});
