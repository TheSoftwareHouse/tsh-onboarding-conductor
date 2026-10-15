import type { ResolvedConnectorSettings } from '../../connector-settings.service';
import {
  CreditBankDataInvalidError,
  type CreditBankData,
} from '../built-in/credit/credit-provider.port';
import {
  MOCK_CREDIT_FAILURE_CODE,
  MockCreditConnector,
  MockCreditProvider,
  buildMockCreditCallbackBody,
} from './mock-credit.connector';

const ONBOARDING_ID = '2d4e1b3c-6f1a-4a39-8f6d-0c2b7a9e5d11';
const SETTINGS = {} as ResolvedConnectorSettings;

const bankData = (name: string, extra: Record<string, unknown> = {}): CreditBankData => ({
  format: 'algoan',
  contentType: 'application/json',
  document: new TextEncoder().encode(
    JSON.stringify({
      accounts: [
        {
          balance: 100,
          owners: [{ name }],
          transactions: [
            { id: 't1', amount: 2500, description: 'Salary' },
            { id: 't2', amount: -40, description: 'Groceries' },
          ],
        },
      ],
      ...extra,
    }),
  ),
});

const raw = (value: string): CreditBankData => ({
  format: 'algoan',
  contentType: 'application/json',
  document: new TextEncoder().encode(value),
});

const assess = async (provider: MockCreditProvider, data: CreditBankData) => {
  const { providerReference } = await provider.startAssessment(SETTINGS, {
    onboardingId: ONBOARDING_ID,
    attempt: 1,
    bankData: data,
  });

  return provider.fetchResult(SETTINGS, {
    onboardingId: ONBOARDING_ID,
    providerReference,
    actionable: true,
  });
};

describe('MockCreditProvider', () => {
  let provider: MockCreditProvider;

  beforeEach(() => {
    provider = new MockCreditProvider();
  });

  describe('validateBankData', () => {
    it('accepts a document with accounts', () => {
      expect(() => provider.validateBankData(bankData('Sherlock Holmes'))).not.toThrow();
    });

    it.each(['not json', '{}', '{"accounts":[]}', '[]'])('rejects %s', (value) => {
      expect(() => provider.validateBankData(raw(value))).toThrow(CreditBankDataInvalidError);
    });
  });

  it('returns the reference mock:<onboardingId>:<attempt>', async () => {
    const receipt = await provider.startAssessment(SETTINGS, {
      onboardingId: ONBOARDING_ID,
      attempt: 2,
      bankData: bankData('Sherlock Holmes'),
    });

    expect(receipt).toEqual({ providerReference: `mock:${ONBOARDING_ID}:2` });
  });

  it('parses the callback body and builds the same event on reconcile', () => {
    const event = provider.parseCallback({
      rawBody: buildMockCreditCallbackBody(ONBOARDING_ID, 'mock:x:1'),
      headers: {},
    });

    expect(event).toEqual({
      onboardingId: ONBOARDING_ID,
      providerReference: 'mock:x:1',
      actionable: true,
    });
    expect(
      provider.buildReconcileEvent({ onboardingId: ONBOARDING_ID, providerReference: 'mock:x:1' }),
    ).toEqual(event);
  });

  it('rejects a callback body without onboardingId', () => {
    expect(() =>
      provider.parseCallback({ rawBody: new TextEncoder().encode('{}'), headers: {} }),
    ).toThrow(/onboardingId/);
  });

  it.each([
    ['Sherlock Holmes', 965, { livingStandard: 3, budgetManagement: 4, financialEvolution: 1 }, 10],
    ['james watson', 598, { livingStandard: -3, budgetManagement: 5, financialEvolution: 2 }, 3],
    ['JAMES MORIARTY', 362, { livingStandard: -5, budgetManagement: 0, financialEvolution: 4 }, 2],
    ['Someone Else', 600, { livingStandard: 0, budgetManagement: 0, financialEvolution: 0 }, 5],
  ])('scores %s', async (name, value, indicators, paymentScore) => {
    const result = await assess(provider, bankData(name));

    expect(result).toMatchObject({
      status: 'scored',
      score: {
        value,
        indicators,
        secondary: { paymentScore: { value: paymentScore } },
      },
    });
  });

  it('fails Fail Case with NO_CHECKING_ACCOUNT', async () => {
    expect(await assess(provider, bankData('Fail Case'))).toMatchObject({
      status: 'failed',
      codes: [MOCK_CREDIT_FAILURE_CODE],
    });
  });

  it('builds a small synthetic report from the input', async () => {
    const result = await assess(provider, bankData('Sherlock Holmes'));

    if (result.status !== 'scored') {
      throw new Error('expected a scored result');
    }

    expect(result.report).toMatchObject({
      scores: { creditScore: { value: 965 }, paymentScore: { value: 10 } },
      metadata: { numberOfDaysInWindow: expect.any(Number) },
      creditInsights: {
        incomes: { categories: [{ totalAmount: 2500 }] },
        expenses: { categories: [{ totalAmount: 40 }] },
      },
      transactions: {
        resources: [
          { id: 't1', enrichments: { category: expect.any(String) } },
          { id: 't2', enrichments: { category: expect.any(String) } },
        ],
      },
    });
    expect(result.report.accounts).toEqual([
      { balance: 100, owners: [{ name: 'Sherlock Holmes' }] },
    ]);
  });

  it('stays pending for a reference it never started', async () => {
    expect(
      await provider.fetchResult(SETTINGS, {
        onboardingId: ONBOARDING_ID,
        providerReference: 'mock:unknown:1',
        actionable: true,
      }),
    ).toEqual({ status: 'pending' });
  });
});

describe('MockCreditConnector', () => {
  it('is an unsigned, callback-capable credit connector named mock_credit', () => {
    const connector = new MockCreditConnector(
      new MockCreditProvider(),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    expect(connector).toMatchObject({
      id: 'mock_credit',
      type: 'credit',
      supportsAsyncCallback: true,
      callbackAuth: { kind: 'none' },
    });
  });
});
