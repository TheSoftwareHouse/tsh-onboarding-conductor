import { countActiveFilters } from '@/lib/count-active-filters';
import type { AdminOnboardingStatus } from '@/api/onboardings/admin-onboardings';
import { DEFAULT_PAGE_SIZE, type PageSize } from '@/lib/pagination';
import type { AdminOnboardingsSearchValues } from './admin-onboardings-search-params';
import { trimmedOrNull } from '@/lib/search-params';

export const WORKFLOW_VERSION_ERROR_MESSAGE = 'Enter a whole number greater than zero.';

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AdminOnboardingFilters {
  /** Empty string means "All" (the criterion is disabled). */
  status: '' | AdminOnboardingStatus;
  workflowId: string;
  workflowVersion: string;
  currentStep: string;
  onboardingId: string;
  /** Rows per page the operator asked for, offered from the shared `PAGE_SIZES`. */
  limit: PageSize;
}

/** Uncommitted draft, awaiting Apply. `status` is excluded: it commits straight from the tab strip, so a drafted copy would undo the operator's tab click on the next Apply. */
export type AdminOnboardingDraftFilters = Omit<AdminOnboardingFilters, 'status'>;

/** Draft filter control values reset to "no criteria applied". Frozen: every consumer shares it. */
export const DEFAULT_ADMIN_ONBOARDING_FILTERS: AdminOnboardingFilters = Object.freeze({
  status: '',
  workflowId: '',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
  limit: DEFAULT_PAGE_SIZE,
});

const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/** True for a base-10 positive whole number. Shared with `adminOnboardingsSearchParams`'s parser - keep it shared, or the control and the URL can disagree about what is requestable. */
export function isValidWorkflowVersion(value: string): boolean {
  return POSITIVE_INTEGER_PATTERN.test(value) && Number(value) > 0;
}

/** Whether the drafted workflow version can be requested; blank names no criterion, so it counts too. */
export function isRequestableWorkflowVersion(value: string): boolean {
  const version = trimmedOrNull(value);
  return version === null || isValidWorkflowVersion(version);
}

/** How many criteria narrow the trail, which is the number the filter band reports. */
export function countActiveAdminOnboardingFilters(state: AdminOnboardingsSearchValues): number {
  return countActiveFilters(state, ['page', 'limit']);
}
