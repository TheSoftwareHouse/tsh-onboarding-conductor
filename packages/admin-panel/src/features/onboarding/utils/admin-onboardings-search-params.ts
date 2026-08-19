import {
  buildFilterSearchParams,
  readEnumParam,
  readPageSizeParam,
  readTextParam,
} from '@/shared/lib/filter-search-params';
import { isAdminOnboardingStatus } from '../types/admin-onboarding';
import { createDefaultAdminOnboardingFilters } from './admin-onboardings-query';
import {
  normalizeAdminOnboardingFilters,
  type AdminOnboardingFilters,
} from './filter-admin-onboardings';

/**
 * Committed filters a URL carries, so a filtered list survives leaving the section and coming back.
 *
 * A criterion the panel itself validates but the URL states badly - an invalid workflow version -
 * drops the whole set rather than being partly honored, which keeps a hand-edited or stale link
 * from showing criteria in the controls that the results were never narrowed by. Anything else the
 * endpoint refuses is reported as the failed request it is, exactly as it would be for a value the
 * operator typed.
 */
export function readAdminOnboardingFilters(params: URLSearchParams): AdminOnboardingFilters {
  const filters: AdminOnboardingFilters = {
    status: readEnumParam(params, 'status', isAdminOnboardingStatus),
    workflowId: readTextParam(params, 'workflowId'),
    workflowVersion: readTextParam(params, 'workflowVersion'),
    currentStep: readTextParam(params, 'currentStep'),
    onboardingId: readTextParam(params, 'onboardingId'),
    limit: readPageSizeParam(params),
  };

  return normalizeAdminOnboardingFilters(filters).ok
    ? filters
    : createDefaultAdminOnboardingFilters();
}

/** The URL that carries a committed filter set and page, named as the endpoint names them. */
export function buildAdminOnboardingsSearchParams(
  filters: AdminOnboardingFilters,
  page: number,
): URLSearchParams {
  return buildFilterSearchParams(
    {
      status: filters.status,
      workflowId: filters.workflowId,
      workflowVersion: filters.workflowVersion,
      currentStep: filters.currentStep,
      onboardingId: filters.onboardingId,
    },
    page,
    filters.limit,
  );
}
