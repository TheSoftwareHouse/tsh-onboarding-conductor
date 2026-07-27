import { useCallback, useMemo, useState } from 'react';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import {
  areAdminOnboardingQueryFiltersEqual,
  buildAdminOnboardingsQueryKey,
  createDefaultAdminOnboardingFilters,
  createTrimmedAdminOnboardingFilters,
  type AdminOnboardingsQueryKey,
} from '../utils/admin-onboardings-query';

export interface CommitAdminOnboardingFiltersResult {
  /** False when the committed filters produce the same query key as before. */
  didQueryKeyChange: boolean;
}

export interface UseAppliedAdminOnboardingFiltersResult {
  /** The last committed (trimmed) filters. */
  appliedFilters: AdminOnboardingFilters;
  /** The canonical React Query key derived from the committed filters. */
  queryKey: AdminOnboardingsQueryKey;
  /** Commits new filters as the applied set. */
  applyFilters: (filters: AdminOnboardingFilters) => CommitAdminOnboardingFiltersResult;
  /** Commits the default (unfiltered) set. */
  resetFilters: () => CommitAdminOnboardingFiltersResult;
}

/** Owns the committed admin onboarding filters and their derived query key. */
export function useAppliedAdminOnboardingFilters(): UseAppliedAdminOnboardingFiltersResult {
  const [appliedFilters, setAppliedFilters] = useState<AdminOnboardingFilters>(
    createDefaultAdminOnboardingFilters,
  );
  const queryKey = useMemo(() => buildAdminOnboardingsQueryKey(appliedFilters), [appliedFilters]);

  const commit = useCallback(
    (filters: AdminOnboardingFilters): CommitAdminOnboardingFiltersResult => {
      const trimmed = createTrimmedAdminOnboardingFilters(filters);
      const nextQueryKey = buildAdminOnboardingsQueryKey(trimmed);
      const didQueryKeyChange = !areAdminOnboardingQueryFiltersEqual(queryKey[1], nextQueryKey[1]);

      setAppliedFilters(trimmed);

      return { didQueryKeyChange };
    },
    [queryKey],
  );

  const resetFilters = useCallback(
    (): CommitAdminOnboardingFiltersResult => commit(createDefaultAdminOnboardingFilters()),
    [commit],
  );

  return { appliedFilters, queryKey, applyFilters: commit, resetFilters };
}
