/**
 * Statuses the engine can report, mirroring `WORKFLOW_STATUSES` in `@tsh/ddl-schema`'s
 * `workflow-contract.ts` and the `onboardings.status` CHECK constraint. Kept as a local literal
 * because the panel depends on the engine over HTTP and should not pull server-only dependencies
 * into the browser bundle.
 */
export const ADMIN_ONBOARDING_STATUSES = [
  'awaiting_user',
  'awaiting_manual_review',
  'approved',
  'rejected',
  'invalid',
] as const;

export type AdminOnboardingStatus = (typeof ADMIN_ONBOARDING_STATUSES)[number];

export function isAdminOnboardingStatus(value: unknown): value is AdminOnboardingStatus {
  return ADMIN_ONBOARDING_STATUSES.includes(value as AdminOnboardingStatus);
}

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

/**
 * Lifecycle-safe projection of the engine's admin onboarding summary.
 * Deliberately excludes `context` and any other field the endpoint may return.
 */
export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  /**
   * Intentionally not narrowed to `AdminOnboardingStatus`. A migration that adds a status must
   * not blank out the whole list for an operator, so an unrecognized value is displayed as-is
   * rather than failing validation.
   */
  status: string;
  currentStep: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
