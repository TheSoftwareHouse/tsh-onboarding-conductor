import { KYC_OUTCOMES, KYC_RETRY_TARGETS } from '@tsh/ddl-schema';

/**
 * Domain contract for the `sumsub_kyc` connector adapter. Every value that crosses a boundary —
 * workflow routing, Sumsub's webhook payload, or the audit metadata both feed — is declared
 * exactly once here, per `.claude/rules/domain-constants.md`.
 *
 * The two exceptions are the outcome and docSet vocabularies below. A workflow document routes on
 * both — a hand-written one in a `when`, a typed document through a `kyc-identity-verification` step's
 * ports — so `@tsh/ddl-schema` owns the declaration and this file only names it for the adapter.
 */

/**
 * The four outcomes the adapter ever reports. The adapter never chooses the next step: every one
 * of these maps to `ConnectorExecutionResult.accepted()`, and the workflow document does all
 * routing on `kycOutcome` through `when` conditions.
 */
export const SUMSUB_KYC_OUTCOMES = KYC_OUTCOMES;

export type SumsubKycOutcome = (typeof SUMSUB_KYC_OUTCOMES)[number];

/**
 * Sumsub's docSet slots. On a `retry` outcome exactly one of these is reset and named in
 * `kycRetryStep`, sending the customer back to the one capture step that produced it.
 */
export const SUMSUB_DOC_SET_KEYS = KYC_RETRY_TARGETS;

export type SumsubDocSetKey = (typeof SUMSUB_DOC_SET_KEYS)[number];

/**
 * Declared individually as well as through the array because the level check names this one
 * directly: a level without it cannot answer the questionnaire the adapter submits
 * (`.claude/rules/domain-constants.md`). The `satisfies` is what keeps the two in step.
 */
export const SUMSUB_DOC_SET_QUESTIONNAIRE = 'QUESTIONNAIRE' satisfies SumsubDocSetKey;

/**
 * Webhook `type` values `mapCallbackResult()` classifies. Every other value is acknowledged and
 * dropped without log noise — see the evaluation order in Task 3.2. Declared individually, not
 * just as the array, so `classifyCallbackEventType` compares against these names instead of
 * repeating the literals inline (`.claude/rules/domain-constants.md`).
 */
export const SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED = 'applicantReviewed';
export const SUMSUB_CALLBACK_EVENT_APPLICANT_PENDING = 'applicantPending';
export const SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD = 'applicantOnHold';
export const SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE = 'applicantAwaitingService';
export const SUMSUB_CALLBACK_EVENT_ONGOING_DOC_EXPIRED = 'ongoingDocExpired';

export const SUMSUB_CALLBACK_EVENT_TYPES = [
  SUMSUB_CALLBACK_EVENT_APPLICANT_REVIEWED,
  SUMSUB_CALLBACK_EVENT_APPLICANT_PENDING,
  SUMSUB_CALLBACK_EVENT_APPLICANT_ON_HOLD,
  SUMSUB_CALLBACK_EVENT_APPLICANT_AWAITING_SERVICE,
  SUMSUB_CALLBACK_EVENT_ONGOING_DOC_EXPIRED,
] as const;

export type SumsubCallbackEventType = (typeof SUMSUB_CALLBACK_EVENT_TYPES)[number];

/**
 * `reviewResult.reviewRejectType` values Sumsub sends on a RED verdict. Finality comes from this
 * field, never from a human-readable label.
 */
export const SUMSUB_REVIEW_REJECT_TYPES = ['RETRY', 'FINAL'] as const;

export type SumsubReviewRejectType = (typeof SUMSUB_REVIEW_REJECT_TYPES)[number];

/**
 * What crosses into the engine as `submittedData` on the callback path. `OnboardingsService.submit`
 * writes this verbatim into audit metadata for `webhook.inbound_callback_applied`, so the payload
 * is a closed, declared set and nothing else: never `clientComment`, MRZ, document numbers, dates
 * of birth, image bytes, or a raw provider payload.
 */
export type SumsubCallbackSubmission = {
  kycOutcome: SumsubKycOutcome;
  kycRetryStep?: SumsubDocSetKey;
  /** Sumsub buttonIds — machine-readable, not identity data. */
  kycReasonCodes?: readonly string[];
  /** `moderationComment` only, never `clientComment`. */
  kycCustomerMessage?: string;
};
