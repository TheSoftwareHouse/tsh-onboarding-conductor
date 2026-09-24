import { useCallback, useMemo } from 'react';
import { useQueryStates } from 'nuqs';
import { DEFAULT_PAGE } from '@/lib/pagination';
import {
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  type AdminOnboardingFilters,
} from '../utils/filter-admin-onboardings';
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
  /** Commits new filters as the applied set on the first page; returns what it committed. */
  applyFilters: (filters: AdminOnboardingFilters) => AdminOnboardingsSearchValues;
  /** Moves to another page of the already committed filters; returns what it committed. */
  goToPage: (page: number) => AdminOnboardingsSearchValues;
  /** Commits the default (unfiltered) set on the first page; returns what it committed. */
  resetFilters: () => AdminOnboardingsSearchValues;
}

/** Owns the committed filters and page in the URL; applying criteria always returns to page 1. */
export function useAppliedAdminOnboardingFilters(): UseAppliedAdminOnboardingFiltersResult {
  // `shallow: false` is load-bearing: without it a commit never reaches react-router and
  // `useLocation()` goes stale. `throttleMs` keeps nuqs' default. See ADR 0018.
  const [state, setState] = useQueryStates(adminOnboardingsSearchParams, {
    history: 'replace',
    shallow: false,
  });

  const appliedFilters = useMemo(() => toAdminOnboardingFilters(state), [state]);

  const appliedPage = state.page;

  const commit = useCallback(
    (filters: AdminOnboardingFilters, page: number): AdminOnboardingsSearchValues => {
      const searchValues = toAdminOnboardingsSearchValues(filters, page);

      setState(searchValues);

      return searchValues;
    },
    [setState],
  );

  const applyFilters = useCallback(
    (filters: AdminOnboardingFilters): AdminOnboardingsSearchValues =>
      commit(filters, DEFAULT_PAGE),
    [commit],
  );

  const goToPage = useCallback(
    (page: number): AdminOnboardingsSearchValues => commit(appliedFilters, page),
    [appliedFilters, commit],
  );

  const resetFilters = useCallback(
    (): AdminOnboardingsSearchValues => commit(DEFAULT_ADMIN_ONBOARDING_FILTERS, DEFAULT_PAGE),
    [commit],
  );

  return {
    appliedFilters,
    appliedSearchValues: state,
    appliedPage,
    applyFilters,
    goToPage,
    resetFilters,
  };
}
