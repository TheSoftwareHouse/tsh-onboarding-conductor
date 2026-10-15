import { Logger } from '@nestjs/common';
import { ConnectorCallbackAlreadyAppliedError } from '../../../errors/connector-callback-already-applied.error';
import type {
  ConnectorCallbackMappingInput,
  ConnectorExecutionInput,
} from '../../../ports/connector-adapter.port';
import {
  ConnectorExecutionMetadataFlag,
  ConnectorExecutionResult,
} from '../../../ports/connector-execution-result';
import { CreditConnector } from './credit-connector';
import {
  CreditBankDataInvalidError,
  type CreditCallbackEvent,
  type CreditProvider,
  type CreditResult,
} from './credit-provider.port';

const CONNECTOR_ID = 'fake_credit';
const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';

const CONFIG: Readonly<Record<string, unknown>> = {
  bands: { approveFrom: 600, reviewFrom: 500 },
  maxAttempts: 2,
  vendorKey: 'vendor-value',
};

const SCORED: CreditResult = {
  status: 'scored',
  score: {
    value: 640.4,
    scale: { min: 0, max: 1000 },
    indicators: { income: 3 },
    secondary: { paymentScore: { value: 7, scale: { min: 0, max: 10 } } },
  },
  report: { scores: [640] },
};

const createInput = (context: Record<string, unknown> = {}): ConnectorExecutionInput => ({
  declaration: { order: 1, config: CONFIG },
  execution: { onboardingId: ONBOARDING_ID, stepName: 'credit' },
  context,
  payload: { bankData: 'document-1' },
  payloadFieldSources: { bankData: 'bankData' },
});

const callbackInput: ConnectorCallbackMappingInput = {
  rawBody: new TextEncoder().encode('{}'),
  headers: {},
};

const createProvider = (): jest.Mocked<CreditProvider> => ({
  id: CONNECTOR_ID,
  name: 'Fake Credit',
  settingsSchema: { fields: [{ key: 'apiKey', secret: false, required: true }] },
  callbackAuth: {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-signature',
    encoding: 'hex',
  },
  validateConfig: jest.fn(),
  validateBankData: jest.fn(),
  startAssessment: jest.fn().mockResolvedValue({ providerReference: 'reference-1' }),
  parseCallback: jest.fn().mockReturnValue({
    onboardingId: ONBOARDING_ID,
    providerReference: 'reference-1',
    actionable: true,
  } satisfies CreditCallbackEvent),
  buildReconcileEvent: jest.fn((reference) => ({ ...reference, actionable: true })),
  fetchResult: jest.fn().mockResolvedValue(SCORED),
});

const createDeps = (context: Record<string, unknown> = {}) => {
  const settings = { find: jest.fn(), get: jest.fn() };

  return {
    provider: createProvider(),
    settings,
    connectorSettingsService: { resolve: jest.fn().mockResolvedValue(settings) },
    documentResolver: {
      resolve: jest.fn().mockResolvedValue({
        finalObjectKey: 'key',
        verifiedEtag: '"etag"',
        verifiedSizeBytes: 2,
        contentType: 'application/json',
      }),
    },
    objectStoragePort: { readObject: jest.fn().mockResolvedValue(Buffer.from('{}')) },
    awaitingCallbackConnectorResolver: {
      findConnector: jest.fn().mockResolvedValue({
        connectorOrder: 1,
        onboarding: { id: ONBOARDING_ID, currentStep: 'credit', context },
        connector: { id: CONNECTOR_ID, order: 1, config: CONFIG, fieldMapping: {} },
        pendingConnector: {
          connectorName: 'Fake Credit',
          connectorId: CONNECTOR_ID,
          connectorOrder: 1,
          providerReference: 'reference-1',
          parkedAt: '2026-10-15T10:00:00.000Z',
        },
      }),
    },
  };
};

class FakeCreditConnector extends CreditConnector {}

const createConnector = (deps: ReturnType<typeof createDeps>) =>
  new FakeCreditConnector(
    deps.provider,
    deps.connectorSettingsService as never,
    deps.documentResolver as never,
    deps.objectStoragePort as never,
    deps.awaitingCallbackConnectorResolver as never,
  );

describe('CreditConnector', () => {
  it('takes its identity from the provider and declares the credit callback fields', () => {
    const deps = createDeps();
    const connector = createConnector(deps);

    expect(connector).toMatchObject({
      id: CONNECTOR_ID,
      type: 'credit',
      supportsAsyncCallback: true,
      callbackAuth: deps.provider.callbackAuth,
      auditRedactedFields: ['creditReport'],
    });
    expect(connector.callbackFields).toEqual([
      'creditOutcome',
      'creditScore',
      'creditScoreBand',
      'creditIndicators',
      'creditSecondaryScores',
      'creditReasonCodes',
      'creditAttemptCount',
      'creditProviderReference',
      'creditReport',
    ]);
  });

  describe('validateDeclaration', () => {
    it('hands the unconsumed keys and the parsed config to the provider', () => {
      const deps = createDeps();

      createConnector(deps).validateDeclaration({ config: CONFIG } as never);

      expect(deps.provider.validateConfig).toHaveBeenCalledWith(
        { vendorKey: 'vendor-value' },
        expect.objectContaining({ maxAttempts: 2 }),
      );
    });

    it('fails on a malformed config', () => {
      expect(() =>
        createConnector(createDeps()).validateDeclaration({ config: {} } as never),
      ).toThrow(/bands/);
    });
  });

  describe('execute', () => {
    it('validates the document, starts the assessment and parks with its reference', async () => {
      const deps = createDeps();

      const result = await createConnector(deps).execute(createInput());

      expect(result).toEqual(
        ConnectorExecutionResult.accepted({ providerReference: 'reference-1' }),
      );
      expect(deps.provider.validateBankData).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ maxAttempts: 2, providerConfig: { vendorKey: 'vendor-value' } }),
      );
      expect(deps.provider.startAssessment).toHaveBeenCalledWith(
        deps.settings,
        expect.objectContaining({ onboardingId: ONBOARDING_ID, attempt: 1 }),
        expect.objectContaining({ maxAttempts: 2, providerConfig: { vendorKey: 'vendor-value' } }),
      );
    });

    it('counts the attempt from the count the previous callback wrote', async () => {
      const deps = createDeps();

      await createConnector(deps).execute(createInput({ creditAttemptCount: 1 }));

      expect(deps.provider.startAssessment).toHaveBeenCalledWith(
        deps.settings,
        expect.objectContaining({ attempt: 2 }),
        expect.anything(),
      );
    });

    it('answers invalid() without calling the provider when the document does not resolve', async () => {
      const deps = createDeps();
      deps.documentResolver.resolve.mockResolvedValueOnce(undefined);

      expect(await createConnector(deps).execute(createInput())).toEqual(
        ConnectorExecutionResult.invalid(),
      );
      expect(deps.provider.startAssessment).not.toHaveBeenCalled();
    });

    it('answers retryable invalid-data when the provider rejects the bank data', async () => {
      const deps = createDeps();
      jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
      deps.provider.validateBankData.mockImplementation(() => {
        throw new CreditBankDataInvalidError(CONNECTOR_ID, 'accounts missing');
      });

      const result = await createConnector(deps).execute(createInput());

      expect(result).toEqual(
        ConnectorExecutionResult.invalidData(
          { bankData: ['INVALID_BANK_DATA'] },
          { [ConnectorExecutionMetadataFlag.RETRYABLE_INVALID_DATA]: true },
        ),
      );
      expect(deps.provider.startAssessment).not.toHaveBeenCalled();
    });

    it('lets any other provider error through', async () => {
      const deps = createDeps();
      deps.provider.startAssessment.mockRejectedValue(new Error('boom'));

      await expect(createConnector(deps).execute(createInput())).rejects.toThrow('boom');
    });
  });

  describe('mapCallbackResult', () => {
    it('re-parks while the provider is still computing', async () => {
      const deps = createDeps();
      deps.provider.fetchResult.mockResolvedValue({ status: 'pending' });

      const callback = await createConnector(deps).mapCallbackResult(callbackInput);

      expect(callback.result.isPending()).toBe(true);
      expect(callback.submittedData).toEqual({});
    });

    it('accepts a scored result with every credit field', async () => {
      const deps = createDeps();

      const callback = await createConnector(deps).mapCallbackResult(callbackInput);

      expect(callback.result).toEqual(ConnectorExecutionResult.accepted());
      expect(callback.submittedData).toEqual({
        creditOutcome: 'approved',
        creditScore: 640,
        creditScoreBand: 'approve',
        creditIndicators: { income: 3 },
        creditSecondaryScores: { paymentScore: { value: 7, scale: { min: 0, max: 10 } } },
        creditReasonCodes: [],
        creditAttemptCount: 1,
        creditProviderReference: 'reference-1',
        creditReport: { scores: [640] },
      });
    });

    it('routes a failed result to retry, then to review at the attempt limit', async () => {
      const deps = createDeps();
      deps.provider.fetchResult.mockResolvedValue({ status: 'failed', codes: ['X'] });
      const connector = createConnector(deps);

      const first = await connector.mapCallbackResult(callbackInput);
      expect(first.submittedData).toMatchObject({ creditOutcome: 'retry', creditAttemptCount: 1 });

      const secondDeps = createDeps({ creditAttemptCount: 1 });
      secondDeps.provider.fetchResult.mockResolvedValue({ status: 'failed', codes: ['X'] });
      const second = await createConnector(secondDeps).mapCallbackResult(callbackInput);
      expect(second.submittedData).toMatchObject({
        creditOutcome: 'review',
        creditAttemptCount: 2,
      });
    });

    it('re-parks a stale reference without reading a result', async () => {
      const deps = createDeps();
      deps.provider.parseCallback.mockReturnValue({
        onboardingId: ONBOARDING_ID,
        providerReference: 'older-reference',
        actionable: true,
      });

      const callback = await createConnector(deps).mapCallbackResult(callbackInput);

      expect(callback.result.isPending()).toBe(true);
      expect(deps.provider.fetchResult).not.toHaveBeenCalled();
    });

    it('re-parks a non-actionable event', async () => {
      const deps = createDeps();
      deps.provider.parseCallback.mockReturnValue({
        onboardingId: ONBOARDING_ID,
        actionable: false,
      });

      const callback = await createConnector(deps).mapCallbackResult(callbackInput);

      expect(callback.result.isPending()).toBe(true);
      expect(deps.provider.fetchResult).not.toHaveBeenCalled();
    });

    it('treats a callback with no awaiting connector as already applied', async () => {
      const deps = createDeps();
      deps.awaitingCallbackConnectorResolver.findConnector.mockResolvedValue(undefined);

      await expect(createConnector(deps).mapCallbackResult(callbackInput)).rejects.toBeInstanceOf(
        ConnectorCallbackAlreadyAppliedError,
      );
    });
  });

  describe('reconcilePending', () => {
    it('answers still_pending while the provider computes', async () => {
      const deps = createDeps();
      deps.provider.fetchResult.mockResolvedValue({ status: 'pending' });

      expect(await createConnector(deps).reconcilePending({ onboardingId: ONBOARDING_ID })).toEqual(
        {
          outcome: 'still_pending',
        },
      );
      expect(deps.provider.buildReconcileEvent).toHaveBeenCalledWith({
        onboardingId: ONBOARDING_ID,
        providerReference: 'reference-1',
      });
    });

    it('resolves with the callback a webhook would have carried', async () => {
      const result = await createConnector(createDeps()).reconcilePending({
        onboardingId: ONBOARDING_ID,
      });

      expect(result).toMatchObject({
        outcome: 'resolved',
        callback: { submittedData: { creditOutcome: 'approved' } },
      });
    });
  });
});
