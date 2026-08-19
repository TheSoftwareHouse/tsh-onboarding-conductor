import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { readPageParam } from '@/shared/lib/filter-search-params';
import { DEFAULT_PAGE } from '@/shared/lib/pagination';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import {
  areAdminOnboardingQueryFiltersEqual,
  buildAdminOnboardingsQueryKey,
  createDefaultAdminOnboardingFilters,
  createTrimmedAdminOnboardingFilters,
  type AdminOnboardingsQueryKey,
} from '../utils/admin-onboardings-query';
import {
  buildAdminOnboardingsSearchParams,
  readAdminOnboardingFilters,
} from '../utils/admin-onboardings-search-params';

export interface CommitAdminOnboardingFiltersResult {
  /** False when the committed filters and page produce the same query key as before. */
  didQueryKeyChange: boolean;
}

export interface UseAppliedAdminOnboardingFiltersResult {
  /** The last committed (trimmed) filters. */
  appliedFilters: AdminOnboardingFilters;
  /** The page the operator is currently on. */
  appliedPage: number;
  /** The canonical React Query key derived from the committed filters and page. */
  queryKey: AdminOnboardingsQueryKey;
  /** Commits new filters as the applied set, returning the operator to the first page. */
  applyFilters: (filters: AdminOnboardingFilters) => CommitAdminOnboardingFiltersResult;
  /** Moves to another page of the already committed filters. */
  goToPage: (page: number) => CommitAdminOnboardingFiltersResult;
  /** Commits the default (unfiltered) set on the first page. */
  resetFilters: () => CommitAdminOnboardingFiltersResult;
}

/**
 * Owns the committed admin onboarding filters, the page the operator is on, and their derived
 * query key.
 *
 * The URL is where they live, so criteria are not erased by leaving the section and coming back,
 * survive a reload, and can be shared as a link to the same filtered list.
 *
 * Applying criteria returns to page 1 because the row a filter change brings into view has no
 * relationship to the offset the operator had reached.
 */
export function useAppliedAdminOnboardingFilters(): UseAppliedAdminOnboardingFiltersResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedFilters = useMemo(() => readAdminOnboardingFilters(searchParams), [searchParams]);
  const appliedPage = readPageParam(searchParams);
  const queryKey = useMemo(
    () => buildAdminOnboardingsQueryKey(appliedFilters, appliedPage),
    [appliedFilters, appliedPage],
  );

  const commit = useCallback(
    (filters: AdminOnboardingFilters, page: number): CommitAdminOnboardingFiltersResult => {
      const trimmed = createTrimmedAdminOnboardingFilters(filters);
      const nextQueryKey = buildAdminOnboardingsQueryKey(trimmed, page);
      const didQueryKeyChange = !areAdminOnboardingQueryFiltersEqual(queryKey[1], nextQueryKey[1]);

      // Replaced rather than pushed: Apply, Reset and the pager are not places the operator
      // navigated to, so Back still leaves the section instead of undoing one filter at a time.
      setSearchParams(buildAdminOnboardingsSearchParams(trimmed, page), { replace: true });

      return { didQueryKeyChange };
    },
    [queryKey, setSearchParams],
  );

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): CommitAdminOnboardingFiltersResult =>
      commit(filters, DEFAULT_PAGE),
    [commit],
  );

  const goToPage = useCallback(
    (page: number): CommitAdminOnboardingFiltersResult => commit(appliedFilters, page),
    [appliedFilters, commit],
  );

  const resetFilters = useCallback(
    (): CommitAdminOnboardingFiltersResult =>
      commit(createDefaultAdminOnboardingFilters(), DEFAULT_PAGE),
    [commit],
  );

  return {
    appliedFilters,
    appliedPage,
    queryKey,
    applyFilters,
    goToPage,
    resetFilters,
  };
}
