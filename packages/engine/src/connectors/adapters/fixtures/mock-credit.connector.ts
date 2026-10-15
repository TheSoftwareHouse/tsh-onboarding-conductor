import { Inject, Injectable } from '@nestjs/common';
import { OBJECT_STORAGE_PORT, type ObjectStoragePort } from '../../../storage/object-storage.port';
import { ConnectorSettingsService } from '../../connector-settings.service';
import type {
  ConnectorCallbackAuth,
  ConnectorCallbackMappingInput,
} from '../../ports/connector-adapter.port';
import { AwaitingCallbackConnectorResolver } from '../../resolvers/awaiting-callback-connector.resolver';
import { CompletedOnboardingDocumentResolver } from '../../resolvers/completed-onboarding-document.resolver';
import { maskAccountIdentifiers } from '../built-in/shared/mask-account-identifiers';
import { CreditConnector } from '../built-in/credit/credit-connector';
import {
  CreditBankDataInvalidError,
  type CreditAssessmentReceipt,
  type CreditBankData,
  type CreditCallbackEvent,
  type CreditPendingReference,
  type CreditProvider,
  type CreditResult,
  type CreditScore,
  type CreditSubmission,
} from '../built-in/credit/credit-provider.port';

export const MOCK_CREDIT_CONNECTOR_ID = 'mock_credit';

/** Reason code of the `Fail Case` persona, the one Algoan reports for a missing checking account. */
export const MOCK_CREDIT_FAILURE_CODE = 'NO_CHECKING_ACCOUNT';

const SCALE = { min: 0, max: 1000 } as const;
const PAYMENT_SCALE = { min: 0, max: 10 } as const;
const DEFAULT_SCORE = 600;
const FAIL_CASE_NAME = 'fail case';

type Persona = Readonly<{
  score: number;
  indicators: Readonly<{
    livingStandard: number;
    budgetManagement: number;
    financialEvolution: number;
  }>;
  paymentScore: number;
}>;

/** The scores measured against the Algoan sandbox, keyed by lower-cased account owner name. */
const PERSONAS: Readonly<Record<string, Persona>> = {
  'sherlock holmes': {
    score: 965,
    indicators: { livingStandard: 3, budgetManagement: 4, financialEvolution: 1 },
    paymentScore: 10,
  },
  'james watson': {
    score: 598,
    indicators: { livingStandard: -3, budgetManagement: 5, financialEvolution: 2 },
    paymentScore: 3,
  },
  'james moriarty': {
    score: 362,
    indicators: { livingStandard: -5, budgetManagement: 0, financialEvolution: 4 },
    paymentScore: 2,
  },
};

const DEFAULT_PERSONA: Persona = {
  score: DEFAULT_SCORE,
  indicators: { livingStandard: 0, budgetManagement: 0, financialEvolution: 0 },
  paymentScore: 5,
};

type BankAccount = Record<string, unknown> & {
  owners?: ReadonlyArray<{ name?: unknown }>;
  transactions?: unknown;
};

type BankDocument = Readonly<{ accounts: BankAccount[] }>;

type BankTransaction = Record<string, unknown> & { amount?: unknown };

/**
 * The body the mock provider posts to `POST /v1/webhooks/mock_credit/callback`. Unsigned, no
 * result inside: the connector reads the result back from the provider, as it does for Algoan.
 */
export const buildMockCreditCallbackBody = (
  onboardingId: string,
  providerReference: string,
): Uint8Array => new TextEncoder().encode(JSON.stringify({ onboardingId, providerReference }));

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const parseBankDocument = (bankData: CreditBankData): BankDocument => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(new TextDecoder().decode(bankData.document));
  } catch {
    throw new CreditBankDataInvalidError(MOCK_CREDIT_CONNECTOR_ID, 'not valid JSON');
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.accounts) || parsed.accounts.length === 0) {
    throw new CreditBankDataInvalidError(
      MOCK_CREDIT_CONNECTOR_ID,
      'accounts must be a non-empty array',
    );
  }

  return { accounts: parsed.accounts.filter(isRecord) };
};

const ownerName = (document: BankDocument): string => {
  const name = document.accounts[0]?.owners?.[0]?.name;

  return typeof name === 'string' ? name.trim().toLowerCase() : '';
};

const transactionsOf = (document: BankDocument): BankTransaction[] =>
  document.accounts.flatMap((account) =>
    Array.isArray(account.transactions) ? account.transactions.filter(isRecord) : [],
  );

const amountOf = (transaction: BankTransaction): number =>
  typeof transaction.amount === 'number' ? transaction.amount : 0;

const totalOf = (transactions: readonly BankTransaction[]): number =>
  transactions.reduce((sum, transaction) => sum + Math.abs(amountOf(transaction)), 0);

const insightCategory = (name: string, transactions: readonly BankTransaction[]) => ({
  name,
  totalAmount: totalOf(transactions),
  transactions,
});

const buildReport = (document: BankDocument, score: CreditScore) => {
  const transactions = transactionsOf(document);
  const incomes = transactions.filter((transaction) => amountOf(transaction) > 0);
  const expenses = transactions.filter((transaction) => amountOf(transaction) <= 0);

  return {
    scores: {
      creditScore: {
        value: score.value,
        version: score.version,
        indicators: score.indicators,
      },
      paymentScore: { value: score.secondary?.paymentScore?.value, version: '1.1.0' },
    },
    metadata: { numberOfDaysInWindow: 90 },
    creditInsights: {
      incomes: {
        totalAmount: totalOf(incomes),
        categories: [insightCategory('salary', incomes)],
      },
      expenses: {
        totalAmount: totalOf(expenses),
        categories: [insightCategory('living', expenses)],
      },
    },
    accounts: maskAccountIdentifiers(
      document.accounts.map((account) =>
        Object.fromEntries(Object.entries(account).filter(([key]) => key !== 'transactions')),
      ),
    ),
    transactions: {
      resources: transactions.map((transaction) => ({
        ...transaction,
        enrichments: { category: amountOf(transaction) > 0 ? 'salary' : 'living' },
      })),
    },
  };
};

/** The mock provider's callback event; `fetchResult` rebuilds the answer from the stored upload. */
type MockCreditEvent = CreditCallbackEvent;

/** A credit provider with no vendor behind it: scores a persona by the account owner's name. */
@Injectable()
export class MockCreditProvider implements CreditProvider<MockCreditEvent> {
  readonly id = MOCK_CREDIT_CONNECTOR_ID;
  readonly name = MOCK_CREDIT_CONNECTOR_ID;
  readonly settingsSchema = { fields: [] } as const;
  readonly callbackAuth: ConnectorCallbackAuth = {
    kind: 'none',
    justification:
      'Local development and test fixture with no upstream provider to share a signing secret with; production ingress additionally requires naming it in CONNECTOR_CALLBACK_UNSIGNED_TYPES, which no deployment should do.',
  };

  /** What the provider "holds" per reference: the document it was handed. */
  private readonly submissions = new Map<string, BankDocument>();

  validateConfig(): void {
    // The mock reads no provider-specific key.
  }

  validateBankData(bankData: CreditBankData): void {
    parseBankDocument(bankData);
  }

  async startAssessment(
    _settings: unknown,
    submission: CreditSubmission,
  ): Promise<CreditAssessmentReceipt> {
    const providerReference = `mock:${submission.onboardingId}:${submission.attempt}`;

    this.submissions.set(providerReference, parseBankDocument(submission.bankData));

    return { providerReference };
  }

  parseCallback(input: ConnectorCallbackMappingInput): MockCreditEvent {
    let body: unknown;

    try {
      body = JSON.parse(new TextDecoder().decode(input.rawBody));
    } catch {
      throw new Error('Callback body must be valid JSON');
    }

    if (!isRecord(body) || typeof body.onboardingId !== 'string') {
      throw new Error('Callback body must carry onboardingId');
    }

    return {
      onboardingId: body.onboardingId,
      providerReference:
        typeof body.providerReference === 'string' ? body.providerReference : undefined,
      actionable: true,
    };
  }

  buildReconcileEvent(reference: CreditPendingReference): MockCreditEvent {
    return { ...reference, actionable: true };
  }

  async fetchResult(_settings: unknown, event: MockCreditEvent): Promise<CreditResult> {
    const document = event.providerReference
      ? this.submissions.get(event.providerReference)
      : undefined;

    if (!document) {
      return { status: 'pending' };
    }

    const name = ownerName(document);

    if (name === FAIL_CASE_NAME) {
      return {
        status: 'failed',
        codes: [MOCK_CREDIT_FAILURE_CODE],
        message: 'One checking account at least is required to compute the analysis.',
      };
    }

    const persona = PERSONAS[name] ?? DEFAULT_PERSONA;
    const score: CreditScore = {
      value: persona.score,
      scale: SCALE,
      version: '1.0.0',
      indicators: persona.indicators,
      secondary: {
        paymentScore: { value: persona.paymentScore, scale: PAYMENT_SCALE, version: '1.1.0' },
      },
    };

    return { status: 'scored', score, report: buildReport(document, score) };
  }
}

/** The mock provider on the credit kernel; the checked-in example workflows run it. */
@Injectable()
export class MockCreditConnector extends CreditConnector<MockCreditEvent> {
  constructor(
    provider: MockCreditProvider,
    connectorSettingsService: ConnectorSettingsService,
    documentResolver: CompletedOnboardingDocumentResolver,
    @Inject(OBJECT_STORAGE_PORT) objectStoragePort: ObjectStoragePort,
    awaitingCallbackConnectorResolver: AwaitingCallbackConnectorResolver,
  ) {
    super(
      provider,
      connectorSettingsService,
      documentResolver,
      objectStoragePort,
      awaitingCallbackConnectorResolver,
    );
  }
}
