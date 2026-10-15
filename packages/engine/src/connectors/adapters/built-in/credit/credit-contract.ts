import { CREDIT_OUTCOMES } from '@tsh/ddl-schema';

/**
 * Domain contract of the provider-neutral credit assessment connector kernel. Every value that
 * crosses a boundary is declared exactly once here, per `.claude/rules/constants.md`. The outcome
 * vocabulary is owned by `@tsh/ddl-schema`, because a workflow document routes on it.
 */
export { CREDIT_OUTCOMES };

export type CreditOutcome = (typeof CREDIT_OUTCOMES)[number];

/** The band a score falls into, from the step's `bands` config. */
export const CREDIT_SCORE_BANDS = ['approve', 'review', 'decline'] as const;

export type CreditScoreBand = (typeof CREDIT_SCORE_BANDS)[number];

/** The step fields a credit connector writes on the callback path (`submittedData`). */
export const CREDIT_OUTCOME_FIELD = 'creditOutcome';
export const CREDIT_SCORE_FIELD = 'creditScore';
export const CREDIT_SCORE_BAND_FIELD = 'creditScoreBand';
export const CREDIT_INDICATORS_FIELD = 'creditIndicators';
export const CREDIT_SECONDARY_SCORES_FIELD = 'creditSecondaryScores';
export const CREDIT_REASON_CODES_FIELD = 'creditReasonCodes';
export const CREDIT_ATTEMPT_COUNT_FIELD = 'creditAttemptCount';
export const CREDIT_PROVIDER_REFERENCE_FIELD = 'creditProviderReference';
export const CREDIT_REPORT_FIELD = 'creditReport';

/** The step's own input field: the bank-data document the client uploads. */
export const CREDIT_BANK_DATA_FIELD = 'bankData';

/** Upper bound of the compact-JSON size of `creditReport` written into the context. */
export const CREDIT_REPORT_MAX_BYTES = 262144;

/**
 * What crosses into the engine as `submittedData` on the callback path. It is written verbatim
 * into audit metadata for `webhook.inbound_callback_applied`, so it is a closed, declared set.
 */
export type CreditCallbackSubmission = {
  creditOutcome: CreditOutcome;
  /** Integer, on the provider's own scale. Absent when the assessment failed. */
  creditScore?: number;
  creditScoreBand?: CreditScoreBand;
  creditIndicators?: Readonly<Record<string, number>>;
  creditSecondaryScores?: Readonly<
    Record<string, { value: number; scale: { min: number; max: number }; version?: string }>
  >;
  /** The provider's failure codes; empty when the assessment was scored. */
  creditReasonCodes: readonly string[];
  /** Assessments started so far for this step, this one included. */
  creditAttemptCount: number;
  creditProviderReference: string;
  /** Provider-shaped and capped at `CREDIT_REPORT_MAX_BYTES`. */
  creditReport?: Readonly<Record<string, unknown>>;
};

/** The field error code on `bankData` when the document cannot be assessed; the client uploads again. */
export const CREDIT_BANK_DATA_INVALID_ERROR = 'INVALID_BANK_DATA';

/** The only content type the kernel accepts for `bankData`. */
export const CREDIT_BANK_DATA_CONTENT_TYPE = 'application/json';
