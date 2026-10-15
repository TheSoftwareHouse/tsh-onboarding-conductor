import { CREDIT_REPORT_MAX_BYTES } from '../credit/credit-contract';
import type { CreditConfig } from '../credit/credit-config';
import type { CreditReport } from '../credit/credit-provider.port';
import { trimCreditReport } from '../credit/credit-outcome';
import {
  ALGOAN_CREDIT_INSIGHT_KINDS,
  type AlgoanCreditInsightKind,
  type AlgoanCredentials,
} from './algoan-contract';
import type { AlgoanClient } from './algoan-client';

/** The `creditInsights` key a section is reported under; only `cash-flows` is camel-cased. */
const INSIGHT_KEYS: Readonly<Record<AlgoanCreditInsightKind, string>> = {
  incomes: 'incomes',
  expenses: 'expenses',
  loans: 'loans',
  risks: 'risks',
  'cash-flows': 'cashFlows',
};

const MASKED_ACCOUNT_KEYS: ReadonlySet<string> = new Set([
  'iban',
  'accountNumber',
  'number',
  'bic',
]);
const MASK_VISIBLE = 4;

/** Replaces each account identifier with `****` and its last four characters. */
export const maskAccountIdentifiers = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(maskAccountIdentifiers);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        typeof nested === 'string' && MASKED_ACCOUNT_KEYS.has(key)
          ? `****${nested.slice(-MASK_VISIBLE)}`
          : maskAccountIdentifiers(nested),
      ]),
    );
  }

  return value;
};

/** Drops every `transactions` array at any depth: the insight sections repeat the list. */
export const stripNestedTransactions = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(stripNestedTransactions);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'transactions')
        .map(([key, nested]) => [key, stripNestedTransactions(nested)]),
    );
  }

  return value;
};

export type AlgoanReportSource = Readonly<{
  customerId: string;
  analysisId: string;
  /** `metadata` of the analysis document. */
  metadata?: Readonly<Record<string, unknown>>;
  scores: Readonly<Record<string, unknown>>;
}>;

/**
 * Assembles the client-visible report: `{ scores, metadata, creditInsights, accounts, essentials,
 * transactions }`, then trims it to the cap, dropping `transactions` first and the insights'
 * `cashFlows` last. `report: 'none'` makes no call beyond the scores the caller already holds;
 * `summary` adds essentials only; insights are read only when the step asked for the product.
 */
export async function buildAlgoanReport(
  client: AlgoanClient,
  credentials: AlgoanCredentials,
  source: AlgoanReportSource,
  config: CreditConfig,
  maxBytes: number = CREDIT_REPORT_MAX_BYTES,
): Promise<CreditReport | undefined> {
  if (config.report === 'none') {
    return undefined;
  }

  const { customerId, analysisId } = source;
  const base = { scores: source.scores, metadata: source.metadata };
  const essentials = await client.getEssentials(credentials, customerId, analysisId);

  if (config.report === 'summary') {
    return { ...base, essentials };
  }

  const [insights, accounts, transactions] = await Promise.all([
    config.products.includes('insights')
      ? Promise.all(
          ALGOAN_CREDIT_INSIGHT_KINDS.map(async (kind) => [
            INSIGHT_KEYS[kind],
            stripNestedTransactions(
              await client.getCreditInsights(credentials, customerId, analysisId, kind),
            ),
          ]),
        )
      : undefined,
    client.listAccounts(credentials, customerId, analysisId),
    client.listTransactions(credentials, customerId, analysisId, 1),
  ]);

  return trimCreditReport(
    {
      ...base,
      ...(insights === undefined ? {} : { creditInsights: Object.fromEntries(insights) }),
      accounts: maskAccountIdentifiers(accounts.resources),
      essentials,
      transactions: transactions.resources,
    },
    maxBytes,
  );
}
