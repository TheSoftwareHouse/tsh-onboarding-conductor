import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AdminOnboardingQueryFilters,
  AdminOnboardingsFetchError,
  AdminOnboardingSummary,
} from '@/api/onboardings/admin-onboardings';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import type { PaginationWindow } from '@/lib/pagination';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import type { AdminOnboardingsSearchValues } from '../utils/admin-onboardings-search-params';
import { useAppliedAdminOnboardingFilters } from './useAppliedAdminOnboardingFilters';

export type AdminOnboardingsPhase = 'loading' | 'error' | 'ready';

export interface UseAdminOnboardingsResult {
  phase: AdminOnboardingsPhase;
  records: AdminOnboardingSummary[];
  /** Page window reported by the last successful fetch, or null while none is available. */
  pagination: PaginationWindow | null;
  error: AdminOnboardingsFetchError | null;
  appliedFilters: AdminOnboardingFilters;
  /** The committed criteria as the URL states them - `null` meaning absent - for active-filter counting. */
  appliedSearchValues: AdminOnboardingsSearchValues;
  appliedPage: number;
  /** Commits new filter criteria, which always returns the operator to the first page. */
  applyFilters: (filters: AdminOnboardingFilters) => void;
  /** Moves to another page of the already committed criteria. */
  goToPage: (page: number) => void;
  refetch: () => void;
  resetFilters: () => void;
}

/** The endpoint's own filters, field by field in request order, so URL-only keys never reach it. */
function toQueryFilters(state: AdminOnboardingsSearchValues): AdminOnboardingQueryFilters {
  return {
    page: state.page,
    limit: state.limit,
    status: state.status,
    workflowId: state.workflowId,
    workflowVersion: state.workflowVersion,
    currentStep: state.currentStep,
    onboardingId: state.onboardingId,
  };
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
  const queryClient = useQueryClient();
  const {
    appliedFilters,
    appliedSearchValues,
    appliedPage,
    applyFilters: commitFilters,
    goToPage: commitPage,
    resetFilters: commitReset,
  } = useAppliedAdminOnboardingFilters();
  const { data, isFetching, isError, error, refetch } = useQuery(
    onboardingQueries.list(toQueryFilters(appliedSearchValues)),
  );

  // An unchanged key would not refetch on its own, so every explicit commit invalidates its key.
  const invalidateCommitted = useCallback(
    (committed: AdminOnboardingsSearchValues): void => {
      void queryClient.invalidateQueries({
        queryKey: onboardingQueries.list(toQueryFilters(committed)).queryKey,
      });
    },
    [queryClient],
  );

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): void => {
      if (isFetching) {
        return;
      }

      invalidateCommitted(commitFilters(filters));
    },
    [commitFilters, invalidateCommitted, isFetching],
  );

  const goToPage = useCallback(
    (page: number): void => {
      if (isFetching) {
        return;
      }

      invalidateCommitted(commitPage(page));
    },
    [commitPage, invalidateCommitted, isFetching],
  );

  const resetFilters = useCallback((): void => {
    if (isFetching) {
      return;
    }

    invalidateCommitted(commitReset());
  }, [commitReset, invalidateCommitted, isFetching]);

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    records: isFetching ? [] : (data?.records ?? []),
    // Cleared while fetching and on failure so the pager never offers pages from a window
    // that is no longer on screen.
    pagination: isFetching || isError ? null : (data?.pagination ?? null),
    error,
    appliedFilters,
    appliedSearchValues,
    appliedPage,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  };
}
