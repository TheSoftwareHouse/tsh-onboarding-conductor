import type { AdminOnboardingStatus, AdminOnboardingSummary } from './types/admin-onboarding';

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminOnboardingFilters {
  /** Empty string means "All" (the criterion is disabled). */
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
}

export interface FilterAdminOnboardingsResult {
  records: AdminOnboardingSummary[];
  /** True when `workflowVersion` holds a non-empty value that is not a positive integer. */
  workflowVersionInvalid: boolean;
}

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Applies the five local, exact-match AND filters to an already-loaded list.
 * Pure and synchronous: never issues a request and always preserves the source order.
 */
export function filterAdminOnboardings(
  records: readonly AdminOnboardingSummary[],
  filters: AdminOnboardingFilters,
): FilterAdminOnboardingsResult {
  const trimmedWorkflowVersion = filters.workflowVersion.trim();
  let workflowVersionValue: number | null = null;

  if (trimmedWorkflowVersion.length > 0) {
    if (!POSITIVE_INTEGER_PATTERN.test(trimmedWorkflowVersion)) {
      return { records: [], workflowVersionInvalid: true };
    }

    workflowVersionValue = Number(trimmedWorkflowVersion);
  }

  const trimmedWorkflowId = filters.workflowId.trim();
  const trimmedCurrentStep = filters.currentStep.trim();
  const trimmedOnboardingId = filters.onboardingId.trim().toLowerCase();

  const filtered = records.filter((record) => {
    if (filters.status !== '' && record.status !== filters.status) {
      return false;
    }

    if (trimmedWorkflowId.length > 0 && record.workflowId !== trimmedWorkflowId) {
      return false;
    }

    if (workflowVersionValue !== null && record.workflowVersion !== workflowVersionValue) {
      return false;
    }

    if (
      trimmedCurrentStep.length > 0 &&
      (record.currentStep === null || record.currentStep !== trimmedCurrentStep)
    ) {
      return false;
    }

    if (
      trimmedOnboardingId.length > 0 &&
      record.onboardingId.toLowerCase() !== trimmedOnboardingId
    ) {
      return false;
    }

    return true;
  });

  return { records: filtered, workflowVersionInvalid: false };
}
