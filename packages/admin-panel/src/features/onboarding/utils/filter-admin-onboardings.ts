import { isAdminOnboardingStatus } from '../types/admin-onboarding';
import type { AdminOnboardingStatus } from '../types/admin-onboarding';
import { DEFAULT_PAGE, type PageSize } from '@/shared/lib/pagination';

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

/**
 * The criteria the page holds as an uncommitted draft, awaiting Apply.
 *
 * `status` is deliberately absent: it commits straight to the URL from the status tab strip,
 * which navigates without remounting the page. A drafted copy would therefore keep whatever
 * status was applied at mount and silently undo the operator's tab click on the next Apply.
 */
export type AdminOnboardingDraftFilters = Omit<AdminOnboardingFilters, 'status'>;

export interface AdminOnboardingQueryFilters {
  page: number;
  limit: number;
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
 *
 * The page window is always sent: the endpoint paginates whether or not it is asked to, so
 * stating the window keeps the request and the pager describing the same page.
 */
export function normalizeAdminOnboardingFilters(
  filters: AdminOnboardingFilters,
  page: number = DEFAULT_PAGE,
): NormalizeAdminOnboardingFiltersResult {
  const normalized: AdminOnboardingQueryFilters = { page, limit: filters.limit };

  if (isAdminOnboardingStatus(filters.status)) {
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
