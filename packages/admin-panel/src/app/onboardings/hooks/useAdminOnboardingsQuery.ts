import { useQuery } from '@tanstack/react-query';
import type { PageSize } from '@/lib/pagination';
import {
  fetchAdminOnboardings,
  type AdminOnboardingsFetchError,
  type AdminOnboardingsPage,
} from '../api/admin-onboardings';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import type { AdminOnboardingsQueryKey } from '../utils/admin-onboardings-query';

export interface UseAdminOnboardingsQueryOptions {
  queryKey: AdminOnboardingsQueryKey;
}

export interface UseAdminOnboardingsQueryResult {
  data: AdminOnboardingsPage | undefined;
  isPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: AdminOnboardingsFetchError | null;
  refetch: () => void;
}

/**
 * Owns the React Query call for one page of the admin onboardings list at a given committed key.
 * The queryFn fetches with the already-normalized query filters embedded in `queryKey[1]`
 * (rather than accepting a separate raw-filters option) so the request always matches the
 * cache entry it populates, with no second, independently-driven normalization pass.
 */
export function useAdminOnboardingsQuery({
  queryKey,
}: UseAdminOnboardingsQueryOptions): UseAdminOnboardingsQueryResult {
  const { data, isPending, isFetching, isError, error, refetch } = useQuery<
    AdminOnboardingsPage,
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
        limit: queryFilters.limit as PageSize,
      };
      return fetchAdminOnboardings({ filters, page: queryFilters.page });
    },
  });

  return { data, isPending, isFetching, isError, error, refetch };
}
