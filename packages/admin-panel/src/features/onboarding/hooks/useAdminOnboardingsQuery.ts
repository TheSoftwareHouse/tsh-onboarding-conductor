import { useQuery } from '@tanstack/react-query';
import { fetchAdminOnboardings, type AdminOnboardingsFetchError } from '../api/admin-onboardings';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import type { AdminOnboardingsQueryKey } from '../utils/admin-onboardings-query';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';

export interface UseAdminOnboardingsQueryOptions {
  queryKey: AdminOnboardingsQueryKey;
}

export interface UseAdminOnboardingsQueryResult {
  data: AdminOnboardingSummary[] | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: AdminOnboardingsFetchError | null;
  refetch: () => void;
}

/**
 * Owns the React Query call for the admin onboardings list at a given committed key.
 * The queryFn fetches with the already-normalized query filters embedded in `queryKey[1]`
 * (rather than accepting a separate raw-filters option) so the request always matches the
 * cache entry it populates, with no second, independently-driven normalization pass.
 */
export function useAdminOnboardingsQuery({
  queryKey,
}: UseAdminOnboardingsQueryOptions): UseAdminOnboardingsQueryResult {
  const { data, isPending, isFetching, isError, error, refetch } = useQuery<
    AdminOnboardingSummary[],
    AdminOnboardingsFetchError
  >({
    queryKey,
    queryFn: () => {
      const queryFilters = queryKey[1];
      const filters: AdminOnboardingFilters = {
        status: queryFilters.status ?? '',
        workflowId: queryFilters.workflowId ?? '',
        workflowVersion: queryFilters.workflowVersion ?? '',
        currentStep: queryFilters.currentStep ?? '',
        onboardingId: queryFilters.onboardingId ?? '',
      };
      return fetchAdminOnboardings({ filters });
    },
  });

  return { data, isPending, isFetching, isError, error, refetch };
}
