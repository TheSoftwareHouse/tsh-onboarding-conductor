import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { readPageParam } from '@/lib/filter-search-params';
import { DEFAULT_PAGE, type PaginationWindow } from '@/lib/pagination';
import type { AuditEventsFetchError } from '../api/admin-audit-events';
import type { AuditEvent } from '../types/audit-event';
import {
  areAuditEventQueryFiltersEqual,
  buildAuditEventsQueryKey,
  createDefaultAuditEventFilters,
  createTrimmedAuditEventFilters,
} from '../utils/audit-events-query';
import {
  buildAuditEventsSearchParams,
  readAuditEventFilters,
} from '../utils/audit-events-search-params';
import type { AuditEventFilters } from '../utils/filter-audit-events';
import { useAuditEventsQuery } from './useAuditEventsQuery';

export type AuditEventsPhase = 'loading' | 'error' | 'ready';

export interface UseAuditEventsResult {
  phase: AuditEventsPhase;
  events: AuditEvent[];
  /** Page window reported by the last successful fetch, or null while none is available. */
  pagination: PaginationWindow | null;
  error: AuditEventsFetchError | null;
  appliedFilters: AuditEventFilters;
  appliedPage: number;
  /** Commits new filter criteria, which always returns the operator to the first page. */
  applyFilters: (filters: AuditEventFilters) => void;
  /** Moves to another page of the already committed criteria. */
  goToPage: (page: number) => void;
  refetch: () => void;
  resetFilters: () => void;
}

/**
 * Owns the committed audit filters, the page the operator is on, and the query that reads them.
 *
 * The URL is where the committed criteria live, so they are not erased by leaving the section and
 * coming back, survive a reload, and can be shared as a link to the same filtered log.
 *
 * Committing criteria that resolve to the same query key would not otherwise refetch (React
 * Query only fetches on key change), so Apply/Reset explicitly refetch in that case to honor the
 * operator's explicit action. Phase and events derive from `isFetching` rather than `isPending`
 * so that any active fetch hides cached rows instead of showing a stale page.
 */
export function useAuditEvents(): UseAuditEventsResult {
  const [searchParams, setSearchParams] = useSearchParams();
  const appliedFilters = useMemo(() => readAuditEventFilters(searchParams), [searchParams]);
  const appliedPage = readPageParam(searchParams);
  const queryKey = useMemo(
    () => buildAuditEventsQueryKey(appliedFilters, appliedPage),
    [appliedFilters, appliedPage],
  );
  const { data, isFetching, isError, error, refetch } = useAuditEventsQuery({ queryKey });

  const commit = useCallback(
    (filters: AuditEventFilters, page: number): void => {
      if (isFetching) {
        return;
      }

      const trimmed = createTrimmedAuditEventFilters(filters);
      const nextQueryKey = buildAuditEventsQueryKey(trimmed, page);

      // Replaced rather than pushed: Apply, Reset and the pager are not places the operator
      // navigated to, so Back still leaves the section instead of undoing one filter at a time.
      setSearchParams(buildAuditEventsSearchParams(trimmed, page), { replace: true });

      if (areAuditEventQueryFiltersEqual(queryKey[1], nextQueryKey[1])) {
        refetch();
      }
    },
    [isFetching, queryKey, refetch, setSearchParams],
  );

  const applyFilters = useCallback(
    (filters: AuditEventFilters): void => commit(filters, DEFAULT_PAGE),
    [commit],
  );

  const goToPage = useCallback(
    (page: number): void => commit(appliedFilters, page),
    [appliedFilters, commit],
  );

  const resetFilters = useCallback(
    (): void => commit(createDefaultAuditEventFilters(), DEFAULT_PAGE),
    [commit],
  );

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    events: isFetching ? [] : (data?.events ?? []),
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
