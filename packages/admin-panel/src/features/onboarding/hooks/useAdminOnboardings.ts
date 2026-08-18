import { useCallback } from 'react';
import type { PaginationWindow } from '@/shared/lib/pagination';
import type { AdminOnboardingsFetchError } from '../api/admin-onboardings';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import { useAppliedAdminOnboardingFilters } from './useAppliedAdminOnboardingFilters';
import { useAdminOnboardingsQuery } from './useAdminOnboardingsQuery';

export type AdminOnboardingsPhase = 'loading' | 'error' | 'ready';

export interface UseAdminOnboardingsResult {
  phase: AdminOnboardingsPhase;
  records: AdminOnboardingSummary[];
  /** Page window reported by the last successful fetch, or null while none is available. */
  pagination: PaginationWindow | null;
  error: AdminOnboardingsFetchError | null;
  appliedFilters: AdminOnboardingFilters;
  appliedPage: number;
  /** Commits new filter criteria, which always returns the operator to the first page. */
  applyFilters: (filters: AdminOnboardingFilters) => void;
  /** Moves to another page of the already committed criteria. */
  goToPage: (page: number) => void;
  refetch: () => void;
  resetFilters: () => void;
}

/**
 * Composes the committed-query and query hooks into the page's data contract.
 * Committing filters or a page that resolve to the same query key would not otherwise
 * refetch (React Query only fetches on key change), so Apply/Reset explicitly
 * refetch in that case to honor the operator's explicit action.
 *
 * Phase and records are derived from `isFetching` rather than `isPending` so that
 * any active fetch - initial load, a changed-key fetch, Reload, or a same-key
 * Apply/Reset (which explicitly refetches without a key change) - reports
 * phase='loading' and hides cached rows instead of showing stale data while
 * React Query refetches in the background.
 */
export function useAdminOnboardings(): UseAdminOnboardingsResult {
  const {
    appliedFilters,
    appliedPage,
    queryKey,
    applyFilters: commitFilters,
    goToPage: commitPage,
    resetFilters: commitReset,
  } = useAppliedAdminOnboardingFilters();
  const { data, isFetching, isError, error, refetch } = useAdminOnboardingsQuery({
    queryKey,
  });

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): void => {
      if (isFetching) {
        return;
      }

      const { didQueryKeyChange } = commitFilters(filters);
      if (!didQueryKeyChange) {
        void refetch();
      }
    },
    [commitFilters, isFetching, refetch],
  );

  const goToPage = useCallback(
    (page: number): void => {
      if (isFetching) {
        return;
      }

      const { didQueryKeyChange } = commitPage(page);
      if (!didQueryKeyChange) {
        void refetch();
      }
    },
    [commitPage, isFetching, refetch],
  );

  const resetFilters = useCallback((): void => {
    if (isFetching) {
      return;
    }

    const { didQueryKeyChange } = commitReset();
    if (!didQueryKeyChange) {
      void refetch();
    }
  }, [commitReset, isFetching, refetch]);

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    records: isFetching ? [] : (data?.records ?? []),
    // Cleared while fetching and on failure so the pager never offers pages from a window
    // that is no longer on screen.
    pagination: isFetching || isError ? null : (data?.pagination ?? null),
    error,
    appliedFilters,
    appliedPage,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  };
}
