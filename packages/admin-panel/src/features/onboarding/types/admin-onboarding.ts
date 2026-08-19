/**
 * Every status the engine emits, in workflow lifecycle order. Mirrors `WORKFLOW_STATUSES` in
 * `@tsh/ddl-schema`, which the engine derives its own status column and query validation from.
 * The panel keeps its own copy because it depends on the engine over HTTP only, and this array is
 * the single list every status check in this feature reads — a narrower one here silently turns a
 * legitimate onboarding into a malformed-payload error.
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

/**
 * Lifecycle-safe projection of the engine's admin onboarding summary.
 * Deliberately excludes `context` and any other field the endpoint may return.
 */
export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: AdminOnboardingStatus;
  currentStep: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
