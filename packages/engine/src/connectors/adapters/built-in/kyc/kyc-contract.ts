import { KYC_OUTCOMES, KYC_RETRY_TARGETS } from '@tsh/ddl-schema';

/**
 * Domain contract of the provider-neutral KYC connector kernel. Every value that crosses a
 * boundary — workflow routing, a provider's webhook, the audit metadata both feed — is declared
 * exactly once here, per `.claude/rules/constants.md`. The outcome and retry-target vocabularies
 * are owned by `@tsh/ddl-schema`, because a workflow document routes on them.
 */
export { KYC_OUTCOMES, KYC_RETRY_TARGETS };

export type KycOutcome = (typeof KYC_OUTCOMES)[number];

export type KycRetryTarget = (typeof KYC_RETRY_TARGETS)[number];

/** The step fields a KYC connector writes on the callback path (`submittedData`). */
export const KYC_OUTCOME_FIELD = 'kycOutcome';
export const KYC_RETRY_STEP_FIELD = 'kycRetryStep';
export const KYC_REASON_CODES_FIELD = 'kycReasonCodes';
export const KYC_CUSTOMER_MESSAGE_FIELD = 'kycCustomerMessage';
export const KYC_ATTEMPT_COUNT_FIELD = 'kycAttemptCount';

/** The field error a document of a type the provider cannot take is refused with. */
export const KYC_DOCUMENT_UNSUPPORTED_ERROR = 'UNSUPPORTED_CONTENT_TYPE';

/**
 * What crosses into the engine as `submittedData` on the callback path. `OnboardingsService.submit`
 * writes this verbatim into audit metadata for `webhook.inbound_callback_applied`, so the payload
 * is a closed, declared set and nothing else: never a provider's internal analyst comment, MRZ,
 * document numbers, dates of birth, image bytes, or a raw provider payload.
 */
export type KycCallbackSubmission = {
  kycOutcome: KycOutcome;
  kycRetryStep?: KycRetryTarget;
  /** Machine-readable provider reason codes, not identity data. */
  kycReasonCodes?: readonly string[];
  /** The provider's customer-facing message only, never an internal comment. */
  kycCustomerMessage?: string;
  /** Total resubmissions so far; written only for a provider that does not count attempts itself. */
  kycAttemptCount?: number;
};
