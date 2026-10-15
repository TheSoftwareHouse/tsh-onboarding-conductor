import { AlgoanRequestRejectedError } from '../../../errors/algoan-request-rejected.error';
import { AlgoanUnavailableException } from '../../../errors/algoan-unavailable.exception';
import { parseCreditConfig } from '../credit/credit-config';
import {
  CreditBankDataInvalidError,
  type CreditBankData,
  type CreditCallbackContext,
  type CreditSubmission,
} from '../credit/credit-provider.port';
import type { AlgoanClient } from './algoan-client';
import { AlgoanCreditProvider } from './algoan-credit.provider';
import { buildSignedMessage } from './algoan-signature';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const REFERENCE = 'cust-1/ana-1';
const CREDENTIALS = { clientId: 'client-1', clientSecret: 'secret-1' };

const settings = {
  find: jest.fn(),
  get: (key: string) =>
    ({ clientId: 'client-1', clientSecret: 'secret-1', callbackSigningSecret: 's' })[key] as never,
};

const config = (overrides: Record<string, unknown> = {}) =>
  parseCreditConfig('algoan_credit', {
    bands: { approveFrom: 700, reviewFrom: 400 },
    maxAttempts: 2,
    ...overrides,
  });

const account = (overrides: Record<string, unknown> = {}) => ({
  type: 'CHECKING',
  usage: 'PERSONAL',
  currency: 'GBP',
  balance: 10,
  balanceDate: '2026-10-15',
  bank: { name: 'Bank' },
  ...overrides,
});

const bankData = (document: unknown): CreditBankData => ({
  format: 'algoan',
  contentType: 'application/json',
  document: new TextEncoder().encode(
    typeof document === 'string' ? document : JSON.stringify(document),
  ),
});

const submission = (accounts: unknown[] = [account()]): CreditSubmission => ({
  onboardingId: ONBOARDING_ID,
  attempt: 1,
  bankData: bankData({ accounts }),
});

const callbackInput = (
  eventName: string,
  payload: unknown = { customerId: 'cust-1', analysisId: 'ana-1' },
) => ({
  rawBody: new TextEncoder().encode(JSON.stringify({ subscription: { eventName }, payload })),
  headers: {},
});

const createClient = () =>
  ({
    createCustomer: jest.fn().mockResolvedValue({ id: 'cust-1', customIdentifier: ONBOARDING_ID }),
    findCustomerByIdentifier: jest
      .fn()
      .mockResolvedValue({ id: 'cust-9', customIdentifier: ONBOARDING_ID }),
    getCustomer: jest.fn().mockResolvedValue({ id: 'cust-1', customIdentifier: ONBOARDING_ID }),
    createAnalysis: jest.fn().mockResolvedValue({ id: 'ana-1', status: 'CREATED' }),
    getAnalysis: jest.fn(),
    getScores: jest.fn().mockResolvedValue({
      creditScore: {
        value: 965,
        version: '1.0.0',
        indicators: { livingStandard: 3, budgetManagement: 4, financialEvolution: 1 },
      },
      paymentScore: { value: 10, version: '1.1.0' },
    }),
    getEssentials: jest.fn().mockResolvedValue({ historicalDepth: 99 }),
    getCreditInsights: jest.fn().mockResolvedValue({}),
    listAccounts: jest.fn().mockResolvedValue({ resources: [{ id: 'acc' }] }),
    listTransactions: jest.fn().mockResolvedValue({ resources: [{ id: 'tx' }] }),
  }) as unknown as jest.Mocked<AlgoanClient>;

const context = (cfg = config()): CreditCallbackContext => ({
  config: cfg,
  providerConfig: cfg.providerConfig,
  onboardingContext: {},
});

describe('AlgoanCreditProvider', () => {
  let client: jest.Mocked<AlgoanClient>;
  let provider: AlgoanCreditProvider;

  beforeEach(() => {
    client = createClient();
    provider = new AlgoanCreditProvider(client);
  });

  it('declares the connector id, three settings and the signed-payload recipe', () => {
    expect(provider.id).toBe('algoan_credit');
    expect(provider.settingsSchema.fields.map((field) => field.key)).toEqual([
      'clientId',
      'clientSecret',
      'callbackSigningSecret',
    ]);
    expect(provider.callbackAuth).toMatchObject({
      kind: 'hmac',
      algorithm: 'sha256',
      signatureHeader: 'X-Hub-Signature',
      encoding: 'hex',
      buildSignedMessage,
    });
  });

  describe('validateConfig', () => {
    it('accepts no providerConfig and a currency code, refuses a malformed one', () => {
      expect(() => provider.validateConfig({})).not.toThrow();
      expect(() => provider.validateConfig({ currency: 'EUR' })).not.toThrow();
      expect(() => provider.validateConfig({ currency: 'euro' })).toThrow();
    });
  });

  describe('validateBankData', () => {
    const reasonOf = (document: unknown, cfg = config()) => {
      try {
        provider.validateBankData(bankData(document), cfg);
      } catch (error) {
        expect(error).toBeInstanceOf(CreditBankDataInvalidError);

        return (error as CreditBankDataInvalidError).reason;
      }

      return undefined;
    };

    it('accepts a personal checking account in the configured currency', () => {
      expect(
        reasonOf({ accounts: [account({ type: 'checking', usage: 'personal' })] }),
      ).toBeUndefined();
      expect(
        reasonOf({ accounts: [account({ currency: 'EUR' })] }, config({ currency: 'EUR' })),
      ).toBeUndefined();
    });

    it.each([
      ['not json', 'document must be UTF-8 JSON'],
      ['[]', 'document must be a JSON object'],
      [{ accounts: [] }, 'accounts must be a non-empty array'],
      [{ accounts: [account({ balance: undefined })] }, 'accounts[0].balance is required'],
      [{ accounts: [account({ balanceDate: '' })] }, 'accounts[0].balanceDate is required'],
      [{ accounts: [account({ bank: {} })] }, 'accounts[0].bank.name is required'],
      [
        { accounts: [account({ type: 'SAVINGS' })] },
        'accounts needs at least one account of type CHECKING, usage PERSONAL and currency GBP',
      ],
      [
        { accounts: [account({ usage: 'PROFESSIONAL' })] },
        'accounts needs at least one account of type CHECKING, usage PERSONAL and currency GBP',
      ],
      [
        { accounts: [account({ currency: 'EUR' })] },
        'accounts needs at least one account of type CHECKING, usage PERSONAL and currency GBP',
      ],
    ])("rejects %j naming Algoan's field", (document, reason) => {
      expect(reasonOf(document)).toBe(reason);
    });
  });

  describe('startAssessment', () => {
    it('creates the customer and the analysis and returns customerId/analysisId', async () => {
      const receipt = await provider.startAssessment(
        settings,
        submission(),
        config({ products: ['creditScore', 'insights'] }),
      );

      expect(client.createCustomer).toHaveBeenCalledWith(CREDENTIALS, ONBOARDING_ID);
      expect(client.createAnalysis).toHaveBeenCalledWith(CREDENTIALS, 'cust-1', {
        accounts: [account()],
        format: 'ALGOAN',
        dataOrigin: 'OPEN_BANKING',
        parameters: { disableScores: false, disableCreditInsights: false },
      });
      expect(receipt).toEqual({ providerReference: REFERENCE });
    });

    it('disables the insights unless the step asked for them', async () => {
      await provider.startAssessment(settings, submission(), config());

      expect(client.createAnalysis.mock.calls[0][2]).toMatchObject({
        parameters: { disableCreditInsights: true },
      });
    });

    it('recovers the customer after a 422 ALREADY_EXISTS', async () => {
      client.createCustomer.mockRejectedValue(
        new AlgoanRequestRejectedError(422, 'ALREADY_EXISTS', 'x'),
      );

      const receipt = await provider.startAssessment(settings, submission(), config());

      expect(client.findCustomerByIdentifier).toHaveBeenCalledWith(CREDENTIALS, ONBOARDING_ID);
      expect(receipt.providerReference).toBe('cust-9/ana-1');
    });

    it('does not mask another rejection or an outage as a reused customer', async () => {
      client.createCustomer.mockRejectedValueOnce(new AlgoanRequestRejectedError(400, 'BAD', 'x'));
      await expect(provider.startAssessment(settings, submission(), config())).rejects.toThrow(
        AlgoanRequestRejectedError,
      );

      client.createCustomer.mockRejectedValueOnce(new AlgoanUnavailableException());
      await expect(provider.startAssessment(settings, submission(), config())).rejects.toThrow(
        AlgoanUnavailableException,
      );
      expect(client.findCustomerByIdentifier).not.toHaveBeenCalled();
    });

    it('fails when the reused customer cannot be found', async () => {
      client.createCustomer.mockRejectedValue(
        new AlgoanRequestRejectedError(422, 'ALREADY_EXISTS', 'x'),
      );
      client.findCustomerByIdentifier.mockResolvedValue(undefined);

      await expect(provider.startAssessment(settings, submission(), config())).rejects.toThrow(
        /could not be found/,
      );
    });
  });

  describe('parseCallback', () => {
    it.each(['analysis_completed', 'analysis_failed'])(
      'maps %s to an actionable event',
      async (name) => {
        await expect(provider.parseCallback(callbackInput(name), settings)).resolves.toEqual({
          onboardingId: ONBOARDING_ID,
          providerReference: REFERENCE,
          actionable: true,
        });
        expect(client.getCustomer).toHaveBeenCalledWith(CREDENTIALS, 'cust-1');
      },
    );

    it('treats bank_details_fetched and unknown events as non-actionable without a lookup', async () => {
      for (const name of ['bank_details_fetched', 'something_else']) {
        await expect(provider.parseCallback(callbackInput(name), settings)).resolves.toEqual({
          onboardingId: '',
          actionable: false,
        });
      }

      expect(client.getCustomer).not.toHaveBeenCalled();
    });

    it('refuses an actionable event without ids and a body that is not JSON', async () => {
      await expect(
        provider.parseCallback(callbackInput('analysis_completed', {}), settings),
      ).rejects.toThrow(/customerId/);
      await expect(
        provider.parseCallback(
          { rawBody: new TextEncoder().encode('nope'), headers: {} },
          settings,
        ),
      ).rejects.toThrow(/valid UTF-8 JSON/);
    });

    it('propagates an Algoan outage so the webhook answers 5xx', async () => {
      client.getCustomer.mockRejectedValue(new AlgoanUnavailableException());

      await expect(
        provider.parseCallback(callbackInput('analysis_completed'), settings),
      ).rejects.toThrow(AlgoanUnavailableException);
    });
  });

  describe('buildReconcileEvent', () => {
    it('keeps the reference and is actionable', () => {
      expect(
        provider.buildReconcileEvent({ onboardingId: ONBOARDING_ID, providerReference: REFERENCE }),
      ).toEqual({
        onboardingId: ONBOARDING_ID,
        providerReference: REFERENCE,
        actionable: true,
      });
    });
  });

  describe('fetchResult', () => {
    const event = { onboardingId: ONBOARDING_ID, providerReference: REFERENCE, actionable: true };

    it.each(['CREATED', 'FETCHING_DATA', 'IN_PROGRESS', 'PENDING', 'SOMETHING_NEW'])(
      'reports %s as pending without reading scores',
      async (status) => {
        client.getAnalysis.mockResolvedValue({ id: 'ana-1', status });

        await expect(provider.fetchResult(settings, event, context())).resolves.toEqual({
          status: 'pending',
        });
        expect(client.getAnalysis).toHaveBeenCalledWith(CREDENTIALS, 'cust-1', 'ana-1');
        expect(client.getScores).not.toHaveBeenCalled();
      },
    );

    it("reports ERROR as failed with Algoan's code and message", async () => {
      client.getAnalysis.mockResolvedValue({
        id: 'ana-1',
        status: 'ERROR',
        error: { code: 'NO_CHECKING_ACCOUNT', message: 'One checking account is required.' },
      });

      await expect(provider.fetchResult(settings, event, context())).resolves.toEqual({
        status: 'failed',
        codes: ['NO_CHECKING_ACCOUNT'],
        message: 'One checking account is required.',
      });
    });

    it('scores a COMPLETED analysis with the payment score as secondary', async () => {
      client.getAnalysis.mockResolvedValue({
        id: 'ana-1',
        status: 'COMPLETED',
        metadata: { m: 1 },
      });

      const result = await provider.fetchResult(settings, event, context());

      expect(result).toMatchObject({
        status: 'scored',
        score: {
          value: 965,
          scale: { min: 0, max: 1000 },
          version: '1.0.0',
          indicators: { livingStandard: 3, budgetManagement: 4, financialEvolution: 1 },
          secondary: { paymentScore: { value: 10, scale: { min: 1, max: 10 }, version: '1.1.0' } },
        },
      });
      expect(result).toMatchObject({
        report: { metadata: { m: 1 }, accounts: [{ id: 'acc' }], transactions: [{ id: 'tx' }] },
      });
    });

    it('skips the extra calls for report none', async () => {
      client.getAnalysis.mockResolvedValue({ id: 'ana-1', status: 'COMPLETED' });

      const result = await provider.fetchResult(
        settings,
        event,
        context(config({ report: 'none' })),
      );

      expect(result).toMatchObject({ status: 'scored', report: {} });
      expect(client.listAccounts).not.toHaveBeenCalled();
      expect(client.getEssentials).not.toHaveBeenCalled();
    });

    it('fails a COMPLETED analysis that carries no credit score', async () => {
      client.getAnalysis.mockResolvedValue({ id: 'ana-1', status: 'COMPLETED' });
      client.getScores.mockResolvedValue({});

      await expect(provider.fetchResult(settings, event, context())).resolves.toEqual({
        status: 'failed',
        codes: ['NO_CREDIT_SCORE'],
      });
    });

    it('refuses a malformed reference and propagates an outage', async () => {
      await expect(
        provider.fetchResult(settings, { ...event, providerReference: 'only-one' }, context()),
      ).rejects.toThrow(/malformed/);

      client.getAnalysis.mockRejectedValue(new AlgoanUnavailableException());
      await expect(provider.fetchResult(settings, event, context())).rejects.toThrow(
        AlgoanUnavailableException,
      );
    });
  });
});
