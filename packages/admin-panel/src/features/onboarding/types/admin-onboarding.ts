export type AdminOnboardingStatus = 'awaiting_user' | 'approved';

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
