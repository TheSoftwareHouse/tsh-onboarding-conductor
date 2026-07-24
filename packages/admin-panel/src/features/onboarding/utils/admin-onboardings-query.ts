import type {
  AdminOnboardingFilters,
  AdminOnboardingQueryFilters,
} from './filter-admin-onboardings';
import { normalizeAdminOnboardingFilters } from './filter-admin-onboardings';

export const ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX = 'admin-onboardings' as const;

/** Canonical React Query key: the endpoint's supported, validated query filters only. */
export type AdminOnboardingsQueryKey = readonly [
  typeof ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX,
  AdminOnboardingQueryFilters,
];

/** Draft filter control values reset to "no criteria applied". */
export function createDefaultAdminOnboardingFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

/** Trims free-text filter values without validating or omitting blanks. */
export function createTrimmedAdminOnboardingFilters(
  filters: AdminOnboardingFilters,
): AdminOnboardingFilters {
  return {
    status: filters.status,
    workflowId: filters.workflowId.trim(),
    workflowVersion: filters.workflowVersion.trim(),
    currentStep: filters.currentStep.trim(),
    onboardingId: filters.onboardingId.trim(),
  };
}

/**
 * Builds the canonical query key from committed filters. Callers are expected to have
 * already validated the filters (the page blocks submission on invalid input), so an
 * invalid workflowVersion collapses to the unfiltered key rather than reaching the network.
 */
export function buildAdminOnboardingsQueryKey(
  filters: AdminOnboardingFilters,
): AdminOnboardingsQueryKey {
  const normalized = normalizeAdminOnboardingFilters(filters);
  return [ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX, normalized.ok ? normalized.filters : {}];
}

/** Structural equality for the normalized query filters embedded in a query key. */
export function areAdminOnboardingQueryFiltersEqual(
  left: AdminOnboardingQueryFilters,
  right: AdminOnboardingQueryFilters,
): boolean {
  return (
    left.status === right.status &&
    left.workflowId === right.workflowId &&
    left.workflowVersion === right.workflowVersion &&
    left.currentStep === right.currentStep &&
    left.onboardingId === right.onboardingId
  );
}
