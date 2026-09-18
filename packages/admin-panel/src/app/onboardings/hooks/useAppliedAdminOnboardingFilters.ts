import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { DEFAULT_PAGE } from '@/lib/pagination';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import {
  buildAdminOnboardingsQueryKey,
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  type AdminOnboardingsQueryKey,
} from '../utils/admin-onboardings-query';
import {
  adminOnboardingsSearchParams,
  toAdminOnboardingFilters,
  toAdminOnboardingsSearchValues,
  type AdminOnboardingsSearchValues,
} from '../utils/admin-onboardings-search-params';

export interface UseAppliedAdminOnboardingFiltersResult {
  /** The last committed (trimmed) filters. */
  appliedFilters: AdminOnboardingFilters;
  /** The committed criteria as the URL states them - `null` meaning absent - for active-filter counting. */
  appliedSearchValues: AdminOnboardingsSearchValues;
  /** The page the operator is currently on. */
  appliedPage: number;
  /** The canonical React Query key derived from the committed filters and page. */
  queryKey: AdminOnboardingsQueryKey;
  /** Commits new filters as the applied set, returning the operator to the first page. */
  applyFilters: (filters: AdminOnboardingFilters) => void;
  /** Moves to another page of the already committed filters. */
  goToPage: (page: number) => void;
  /** Commits the default (unfiltered) set on the first page. */
  resetFilters: () => void;
}

/**
 * Owns the committed admin onboarding filters, the page the operator is on, and their derived
 * query key. Applying criteria returns to page 1, since the row a filter change brings into view
 * has no relationship to the offset the operator had reached.
 */
export function useAppliedAdminOnboardingFilters(): UseAppliedAdminOnboardingFiltersResult {
  const queryClient = useQueryClient();
  // `shallow: false` is load-bearing: without it a commit never reaches react-router and
  // `useLocation()` goes stale. `throttleMs` keeps nuqs' default. See ADR 0018.
  const [state, setState] = useQueryStates(adminOnboardingsSearchParams, {
    history: 'replace',
    shallow: false,
  });

  const appliedFilters = useMemo(() => toAdminOnboardingFilters(state), [state]);

  const appliedPage = state.page;

  const queryKey = useMemo(() => buildAdminOnboardingsQueryKey(state), [state]);

  const commit = useCallback(
    (filters: AdminOnboardingFilters, page: number): void => {
      const searchValues = toAdminOnboardingsSearchValues(filters, page);

      setState(searchValues);

      // Apply, Reset and the pager are explicit actions expecting a fresh read even when they
      // resolve to the already-applied criteria, which an unchanged key would not itself refetch.
      void queryClient.invalidateQueries({ queryKey: buildAdminOnboardingsQueryKey(searchValues) });
    },
    [queryClient, setState],
  );

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): void => commit(filters, DEFAULT_PAGE),
    [commit],
  );

  const goToPage = useCallback(
    (page: number): void => commit(appliedFilters, page),
    [appliedFilters, commit],
  );

  const resetFilters = useCallback(
    (): void => commit(DEFAULT_ADMIN_ONBOARDING_FILTERS, DEFAULT_PAGE),
    [commit],
  );

  return {
    appliedFilters,
    appliedSearchValues: state,
    appliedPage,
    queryKey,
    applyFilters,
    goToPage,
    resetFilters,
  };
}
