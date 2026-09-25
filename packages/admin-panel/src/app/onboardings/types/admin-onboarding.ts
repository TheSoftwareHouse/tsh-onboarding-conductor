import {
  isAdminOnboardingStatus,
  type AdminOnboardingStatus,
} from '@/api/onboardings/admin-onboardings';

const STATUS_LABELS: Record<AdminOnboardingStatus, string> = {
  awaiting_user: 'Awaiting user',
  awaiting_manual_review: 'Awaiting manual review',
  approved: 'Approved',
  rejected: 'Rejected',
  invalid: 'Invalid',
};

/** Human-readable status label, falling back to the raw value for an unrecognized status. */
export function describeAdminOnboardingStatus(status: string): string {
  return isAdminOnboardingStatus(status) ? STATUS_LABELS[status] : status;
}

/** How a status reads: still moving, parked with an operator, or settled for good. */
export type AdminOnboardingStatusTone = 'progress' | 'review' | 'success' | 'failure';

const STATUS_TONES: Record<AdminOnboardingStatus, AdminOnboardingStatusTone> = {
  awaiting_user: 'progress',
  awaiting_manual_review: 'review',
  approved: 'success',
  rejected: 'failure',
  invalid: 'failure',
};

/** Tone for a status, falling back to the neutral one for a status this build does not know. */
export function describeAdminOnboardingStatusTone(status: string): AdminOnboardingStatusTone {
  return isAdminOnboardingStatus(status) ? STATUS_TONES[status] : 'progress';
}
