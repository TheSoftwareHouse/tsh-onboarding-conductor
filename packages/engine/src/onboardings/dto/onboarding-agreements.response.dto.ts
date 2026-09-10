import {
  NOT_ACCEPTED_AGREEMENT_STATUS,
  type AgreementType,
  type OnboardingAgreementStatus,
} from '../../agreements/agreement.types';
import type { OnboardingAgreementSummary } from '../onboarding-agreements.repository';

/**
 * One agreement family an onboarding holds, as accepted-versus-latest plus the label that pairing
 * derives to. The repository reports the raw versions; naming the state is this layer's job, and
 * it is the same rule the `onboarding_agreement_statuses` view applies per family.
 */
export type OnboardingAgreementResponse = {
  key: string;
  type: AgreementType;
  latestAgreementId: string;
  latestVersion: number;
  acceptedVersion: number | null;
  acceptedAt: string | null;
  status: OnboardingAgreementStatus;
};

/** Every family one onboarding holds. A family it was never linked to is simply absent. */
export type OnboardingAgreementsResponse = {
  onboardingId: string;
  items: OnboardingAgreementResponse[];
};

/** What a link call reports. `created` is false when the pair was already linked. */
export type LinkAgreementResponse = {
  onboardingId: string;
  agreementId: string;
  key: string;
  version: number;
  created: boolean;
};

/** What an acceptance reports. `acceptedAt` is the first acceptance, not the replayed one. */
export type AcceptAgreementResponse = {
  onboardingId: string;
  agreementId: string;
  key: string;
  version: number;
  acceptedAt: string | null;
};

export function toOnboardingAgreementsResponse(
  onboardingId: string,
  summaries: readonly OnboardingAgreementSummary[],
): OnboardingAgreementsResponse {
  return {
    onboardingId,
    items: summaries.map((summary) => ({
      key: summary.key,
      type: summary.type,
      latestAgreementId: summary.latestAgreementId,
      latestVersion: summary.latestVersion,
      acceptedVersion: summary.acceptedVersion,
      acceptedAt: summary.acceptedAt === null ? null : summary.acceptedAt.toISOString(),
      status: deriveAgreementStatus(summary),
    })),
  };
}

function deriveAgreementStatus(summary: OnboardingAgreementSummary): OnboardingAgreementStatus {
  if (summary.acceptedVersion === null) {
    return NOT_ACCEPTED_AGREEMENT_STATUS;
  }

  return summary.acceptedVersion < summary.latestVersion ? 'outdated' : 'current';
}
