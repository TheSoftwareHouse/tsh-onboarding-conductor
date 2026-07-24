import type { AdminOnboardingStatus } from './admin-onboarding';

export const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminOnboardingFilters {
  /** Empty string means "All" (the criterion is disabled). */
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
}

export interface AdminOnboardingQueryFilters {
  status?: AdminOnboardingStatus;
  workflowId?: string;
  workflowVersion?: string;
  currentStep?: string;
  onboardingId?: string;
}

export type NormalizeAdminOnboardingFiltersResult =
  | { ok: true; filters: AdminOnboardingQueryFilters }
  | {
      ok: false;
      error: {
        reason: 'invalid-workflow-version';
        message: string;
      };
    };

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Normalizes draft filter controls into the endpoint's supported query keys.
 * Values are trimmed, blank values are omitted, and workflowVersion is validated.
 */
export function normalizeAdminOnboardingFilters(
  filters: AdminOnboardingFilters,
): NormalizeAdminOnboardingFiltersResult {
  const normalized: AdminOnboardingQueryFilters = {};

  if (filters.status === 'awaiting_user' || filters.status === 'approved') {
    normalized.status = filters.status;
  }

  const workflowId = filters.workflowId.trim();
  if (workflowId.length > 0) {
    normalized.workflowId = workflowId;
  }

  const workflowVersion = filters.workflowVersion.trim();
  if (workflowVersion.length > 0) {
    if (!POSITIVE_INTEGER_PATTERN.test(workflowVersion) || Number(workflowVersion) <= 0) {
      return {
        ok: false,
        error: {
          reason: 'invalid-workflow-version',
          message: WORKFLOW_VERSION_ERROR_MESSAGE,
        },
      };
    }
    normalized.workflowVersion = workflowVersion;
  }

  const currentStep = filters.currentStep.trim();
  if (currentStep.length > 0) {
    normalized.currentStep = currentStep;
  }

  const onboardingId = filters.onboardingId.trim();
  if (onboardingId.length > 0) {
    normalized.onboardingId = onboardingId;
  }

  return { ok: true, filters: normalized };
}
