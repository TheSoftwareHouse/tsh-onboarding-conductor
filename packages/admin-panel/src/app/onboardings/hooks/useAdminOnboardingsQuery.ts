import { useQuery } from '@tanstack/react-query';
import {
  fetchAdminOnboardings,
  type AdminOnboardingsFetchError,
  type AdminOnboardingsPage,
} from '../api/admin-onboardings';
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
    queryFn: () => fetchAdminOnboardings(queryKey[1]),
  });

  return { data, isPending, isFetching, isError, error, refetch };
}
