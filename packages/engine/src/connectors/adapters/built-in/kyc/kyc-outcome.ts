import {
  KYC_ATTEMPT_COUNT_FIELD,
  KYC_CUSTOMER_MESSAGE_FIELD,
  KYC_OUTCOME_FIELD,
  KYC_REASON_CODES_FIELD,
  KYC_RETRY_STEP_FIELD,
  type KycCallbackSubmission,
  type KycRetryTarget,
} from './kyc-contract';
import type { KycIdentityComparison, KycIdentityComparisonResult } from './kyc-identity-comparison';
import type { KycVerdict } from './kyc-provider.port';

/** Everything `evaluateKycOutcome` needs besides the provider's verdict. */
export type KycOutcomeInput = Readonly<{
  identityComparison: KycIdentityComparison;
  /** `kycAttemptCount` as the onboarding holds it; 0 when never written. */
  previousAttemptCount: number;
  maxAttemptsPerDocSet: number;
  providerCountsAttempts: boolean;
}>;

type KycReasonFields = Readonly<{
  reasonCodes?: readonly string[];
  customerMessage?: string;
}>;

/**
 * The decision that applies an outcome, carrying exactly what the closed `submittedData` and the
 * log lines need. Not returned to the engine as-is — `buildKycSubmittedData` narrows it.
 */
export type KycAppliedEvaluation =
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'needs_review';
      providerReason: string;
      detail?: Readonly<Record<string, number>>;
    }>
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'identity_guard';
      mismatchKind: Exclude<KycIdentityComparisonResult, 'match'>;
      divergedFields: KycIdentityComparison['divergedFields'];
    }>
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'attempts_exhausted';
      target: KycRetryTarget;
      attempts: number;
      maxAttemptsPerDocSet: number;
    }>
  | (Readonly<{ kycOutcome: 'refused' }> & KycReasonFields)
  | (Readonly<{
      kycOutcome: 'retry';
      target: KycRetryTarget;
      attempts: number;
      maxAttemptsPerDocSet: number;
      /** Set only when the provider does not count attempts, so the kernel must persist the total. */
      recordedAttemptCount?: number;
    }> &
      KycReasonFields)
  | Readonly<{ kycOutcome: 'verified' }>;

/** Either leave the step parked for the provider's next call, or apply a decision. */
export type KycOutcomeEvaluation =
  Readonly<{ action: 'park' }> | Readonly<{ action: 'apply'; decision: KycAppliedEvaluation }>;

const PARK: KycOutcomeEvaluation = { action: 'park' };

const apply = (decision: KycAppliedEvaluation): KycOutcomeEvaluation => ({
  action: 'apply',
  decision,
});

/**
 * Decides what a provider verdict means, in order, stopping at the first match: `pending` parks;
 * `needs_review` is human review; `approved` is verified unless the declared identity does not
 * match what the provider verified (a guard that overrides the provider's own approval);
 * `declined` is refused; `resubmission` is a retry unless the provider said the limit is exceeded
 * or the attempt count has reached the cap — the cap beats the retry it is capping.
 */
export function evaluateKycOutcome(
  verdict: KycVerdict,
  input: KycOutcomeInput,
): KycOutcomeEvaluation {
  switch (verdict.kind) {
    case 'pending':
      return PARK;
    case 'needs_review':
      return apply({
        kycOutcome: 'human_review',
        reason: 'needs_review',
        providerReason: verdict.reason,
        detail: verdict.detail,
      });
    case 'approved':
      if (input.identityComparison.result !== 'match') {
        return apply({
          kycOutcome: 'human_review',
          reason: 'identity_guard',
          mismatchKind: input.identityComparison.result,
          divergedFields: input.identityComparison.divergedFields,
        });
      }

      return apply({ kycOutcome: 'verified' });
    case 'declined':
      return apply({
        kycOutcome: 'refused',
        reasonCodes: verdict.reasonCodes,
        customerMessage: verdict.customerMessage,
      });
    case 'resubmission': {
      const attempts = verdict.attemptCount ?? input.previousAttemptCount + 1;

      if (verdict.limitExceeded === true || attempts >= input.maxAttemptsPerDocSet) {
        return apply({
          kycOutcome: 'human_review',
          reason: 'attempts_exhausted',
          target: verdict.target,
          attempts,
          maxAttemptsPerDocSet: input.maxAttemptsPerDocSet,
        });
      }

      return apply({
        kycOutcome: 'retry',
        target: verdict.target,
        attempts,
        maxAttemptsPerDocSet: input.maxAttemptsPerDocSet,
        recordedAttemptCount: input.providerCountsAttempts ? undefined : attempts,
        reasonCodes: verdict.reasonCodes,
        customerMessage: verdict.customerMessage,
      });
    }
  }
}

function buildReasonFields(
  evaluation: KycReasonFields,
): Pick<KycCallbackSubmission, 'kycReasonCodes' | 'kycCustomerMessage'> {
  const fields: Pick<KycCallbackSubmission, 'kycReasonCodes' | 'kycCustomerMessage'> = {};

  if (evaluation.reasonCodes && evaluation.reasonCodes.length > 0) {
    fields[KYC_REASON_CODES_FIELD] = evaluation.reasonCodes;
  }

  if (evaluation.customerMessage) {
    fields[KYC_CUSTOMER_MESSAGE_FIELD] = evaluation.customerMessage;
  }

  return fields;
}

/**
 * Maps the decision that fired to the closed `KycCallbackSubmission` — the only shape that
 * crosses into `submittedData`, and therefore into the audit log. Reason codes and the customer
 * message travel only with `refused` and `retry`.
 */
export function buildKycSubmittedData(evaluation: KycAppliedEvaluation): KycCallbackSubmission {
  switch (evaluation.kycOutcome) {
    case 'retry':
      return {
        [KYC_OUTCOME_FIELD]: 'retry',
        [KYC_RETRY_STEP_FIELD]: evaluation.target,
        ...buildReasonFields(evaluation),
        ...(evaluation.recordedAttemptCount === undefined
          ? {}
          : { [KYC_ATTEMPT_COUNT_FIELD]: evaluation.recordedAttemptCount }),
      };
    case 'refused':
      return { [KYC_OUTCOME_FIELD]: 'refused', ...buildReasonFields(evaluation) };
    case 'verified':
      return { [KYC_OUTCOME_FIELD]: 'verified' };
    case 'human_review':
      return { [KYC_OUTCOME_FIELD]: 'human_review' };
  }
}
