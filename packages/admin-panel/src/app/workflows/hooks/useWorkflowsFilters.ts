import { useCallback, useMemo } from 'react';
import { useQueryStates } from 'nuqs';
import type { AdminWorkflowQueryFilters } from '@/api/workflows/admin-workflows';
import { DEFAULT_PAGE } from '@/lib/pagination';
import {
  DEFAULT_ADMIN_WORKFLOW_FILTERS,
  type AdminWorkflowFilters,
} from '../utils/filter-admin-workflows';
import {
  adminWorkflowsSearchParams,
  toAdminWorkflowFilters,
  toAdminWorkflowQueryFilters,
  toAdminWorkflowsSearchValues,
  type AdminWorkflowsSearchValues,
} from '../utils/admin-workflows-search-params';

export interface UseWorkflowsFiltersResult {
  /** Ready for `workflowQueries.list`: the fixed page size, every other criterion `null` when absent. */
  filters: AdminWorkflowQueryFilters;
  /** The last committed filters, in the shape the panel's controls read. */
  appliedFilters: AdminWorkflowFilters;
  /** The committed criteria as the URL states them, for the "N active" count. */
  appliedSearchValues: AdminWorkflowsSearchValues;
  /** Commits new filters as the applied set on the first page. */
  applyFilters: (filters: AdminWorkflowFilters) => void;
  /** Moves to another page of the already committed filters. */
  goToPage: (page: number) => void;
  /** Commits the default (unfiltered) set on the first page. */
  resetFilters: () => void;
}

/** Owns the committed filters and page in the URL; applying criteria always returns to page 1. */
export function useWorkflowsFilters(): UseWorkflowsFiltersResult {
  // `shallow: false` is load-bearing: without it `useLocation()` goes stale. See ADR 0018.
  const [state, setState] = useQueryStates(adminWorkflowsSearchParams, {
    history: 'replace',
    shallow: false,
  });

  const filters = useMemo(() => toAdminWorkflowQueryFilters(state), [state]);
  const appliedFilters = useMemo(() => toAdminWorkflowFilters(state), [state]);

  const commit = useCallback(
    (nextFilters: AdminWorkflowFilters, page: number): void => {
      setState(toAdminWorkflowsSearchValues(nextFilters, page));
    },
    [setState],
  );

  const applyFilters = useCallback(
    (nextFilters: AdminWorkflowFilters): void => commit(nextFilters, DEFAULT_PAGE),
    [commit],
  );

  const goToPage = useCallback(
    (page: number): void => commit(appliedFilters, page),
    [appliedFilters, commit],
  );

  const resetFilters = useCallback(
    (): void => commit(DEFAULT_ADMIN_WORKFLOW_FILTERS, DEFAULT_PAGE),
    [commit],
  );

  return {
    filters,
    appliedFilters,
    appliedSearchValues: state,
    applyFilters,
    goToPage,
    resetFilters,
  };
}
