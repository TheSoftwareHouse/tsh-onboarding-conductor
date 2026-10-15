import {
  CREDIT_REPORT_MAX_BYTES,
  type CreditCallbackSubmission,
  type CreditOutcome,
  type CreditScoreBand,
} from './credit-contract';
import type { CreditConfig } from './credit-config';
import type { CreditReport, CreditResult } from './credit-provider.port';

export type CreditEvaluation = Readonly<{
  outcome: CreditOutcome;
  /** Absent when the assessment failed: there was no score to band. */
  band?: CreditScoreBand;
  reasonCodes: readonly string[];
}>;

/** The integer score a client sees and the bands are read against: rounded once, here. */
const roundScore = (value: number): number => Math.round(value);

type SettledCreditResult = Exclude<CreditResult, { status: 'pending' }>;

/**
 * Turns a settled provider result into the kernel's outcome. A score is banded against the
 * step's own thresholds; a failure retries while attempts remain, then goes to a human.
 */
export function evaluateCreditOutcome(
  result: SettledCreditResult,
  config: CreditConfig,
  attemptCount: number,
): CreditEvaluation {
  if (result.status === 'failed') {
    return {
      outcome: attemptCount < config.maxAttempts ? 'retry' : 'review',
      reasonCodes: result.codes,
    };
  }

  const value = roundScore(result.score.value);

  if (value >= config.bands.approveFrom) {
    return { outcome: 'approved', band: 'approve', reasonCodes: [] };
  }

  if (value >= config.bands.reviewFrom) {
    return { outcome: 'review', band: 'review', reasonCodes: [] };
  }

  return { outcome: 'declined', band: 'decline', reasonCodes: [] };
}

const SUMMARY_REPORT_KEYS = ['scores', 'metadata'] as const;

const byteLength = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));

const omitKey = (value: Readonly<Record<string, unknown>>, key: string) =>
  Object.fromEntries(Object.entries(value).filter(([entryKey]) => entryKey !== key));

const withoutNestedTransactions = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map(withoutNestedTransactions);
  }

  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== 'transactions')
        .map(([key, nested]) => [key, withoutNestedTransactions(nested)]),
    );
  }

  return value;
};

/**
 * Brings a report under `CREDIT_REPORT_MAX_BYTES` of compact JSON, dropping the bulkiest parts
 * first: top-level `transactions`, every `transactions` array inside `creditInsights`, then
 * `creditInsights.cashFlows`. A report still over the cap is replaced by a marker.
 */
export function trimCreditReport(
  report: CreditReport,
  maxBytes: number = CREDIT_REPORT_MAX_BYTES,
): CreditReport {
  const originalBytes = byteLength(report);

  if (originalBytes <= maxBytes) {
    return report;
  }

  const withoutTransactions = omitKey(report, 'transactions');

  if (byteLength(withoutTransactions) <= maxBytes) {
    return withoutTransactions;
  }

  const insights = withoutTransactions.creditInsights;
  const withoutInsightTransactions = isRecord(insights)
    ? { ...withoutTransactions, creditInsights: withoutNestedTransactions(insights) }
    : withoutTransactions;

  if (byteLength(withoutInsightTransactions) <= maxBytes) {
    return withoutInsightTransactions;
  }

  const trimmedInsights = withoutInsightTransactions.creditInsights;

  if (isRecord(trimmedInsights)) {
    const withoutCashFlows = {
      ...withoutInsightTransactions,
      creditInsights: omitKey(trimmedInsights, 'cashFlows'),
    };

    if (byteLength(withoutCashFlows) <= maxBytes) {
      return withoutCashFlows;
    }
  }

  return { truncated: true, bytes: originalBytes };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const shapeReport = (report: CreditReport, config: CreditConfig): CreditReport | undefined => {
  if (config.report === 'none') {
    return undefined;
  }

  if (config.report === 'summary') {
    return Object.fromEntries(
      Object.entries(report).filter(([key]) =>
        (SUMMARY_REPORT_KEYS as readonly string[]).includes(key),
      ),
    );
  }

  return trimCreditReport(report);
};

/**
 * Builds the callback `submittedData` for a settled result: every `credit*` field the result
 * carries, and nothing else.
 */
export function buildCreditSubmittedData(input: {
  result: SettledCreditResult;
  evaluation: CreditEvaluation;
  config: CreditConfig;
  attemptCount: number;
  providerReference: string;
}): CreditCallbackSubmission {
  const { result, evaluation, config, attemptCount, providerReference } = input;

  const base = {
    creditOutcome: evaluation.outcome,
    creditReasonCodes: evaluation.reasonCodes,
    creditAttemptCount: attemptCount,
    creditProviderReference: providerReference,
  };

  if (result.status === 'failed') {
    return base;
  }

  const report = shapeReport(result.report, config);

  return {
    ...base,
    creditScore: roundScore(result.score.value),
    creditScoreBand: evaluation.band,
    creditIndicators: result.score.indicators,
    creditSecondaryScores: result.score.secondary,
    ...(report === undefined ? {} : { creditReport: report }),
  };
}
