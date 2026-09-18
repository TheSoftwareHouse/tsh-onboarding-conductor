import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useQueryStates } from 'nuqs';
import { DEFAULT_PAGE, type PaginationWindow } from '@/lib/pagination';
import type { AuditEventsFetchError } from '../api/admin-audit-events';
import type { AuditEvent } from '../types/audit-event';
import { buildAuditEventsQueryKey, DEFAULT_AUDIT_EVENT_FILTERS } from '../utils/audit-events-query';
import {
  auditEventsSearchParams,
  toAuditEventFilters,
  toAuditEventsSearchValues,
  type AuditEventsSearchValues,
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
  appliedSearchValues: AuditEventsSearchValues;
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
 * The URL is where the committed criteria live, so a reload or a return via the sidebar keeps
 * them. Apply/Reset invalidate explicitly, since a commit resolving to the same query key would
 * not otherwise refetch.
 */
export function useAuditEvents(): UseAuditEventsResult {
  const queryClient = useQueryClient();
  // `shallow: false` is load-bearing: without it a commit never reaches react-router and
  // `useLocation()` goes stale. `throttleMs` keeps nuqs' default. See ADR 0018.
  const [state, setState] = useQueryStates(auditEventsSearchParams, {
    history: 'replace',
    shallow: false,
  });
  const appliedFilters = useMemo(() => toAuditEventFilters(state), [state]);
  const appliedPage = state.page;
  const queryKey = useMemo(() => buildAuditEventsQueryKey(state), [state]);
  const { data, isFetching, isError, error, refetch } = useAuditEventsQuery({ queryKey });

  const commit = useCallback(
    (filters: AuditEventFilters, page: number): void => {
      if (isFetching) {
        return;
      }

      const searchValues = toAuditEventsSearchValues(filters, page);

      // Replaced, not pushed, so Back still leaves the section rather than undoing one filter
      // at a time. Every key is written explicitly so a stale one nuqs was not told about does
      // not survive.
      setState(searchValues);

      // An unchanged key would not refetch on its own; invalidating covers that case for free
      // when the key did change too.
      void queryClient.invalidateQueries({ queryKey: buildAuditEventsQueryKey(searchValues) });
    },
    [isFetching, queryClient, setState],
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
    (): void => commit(DEFAULT_AUDIT_EVENT_FILTERS, DEFAULT_PAGE),
    [commit],
  );

  return {
    phase: isFetching ? 'loading' : isError ? 'error' : 'ready',
    events: isFetching ? [] : (data?.events ?? []),
    // Cleared on fetch/error so the pager never offers pages from a window no longer on screen.
    pagination: isFetching || isError ? null : (data?.pagination ?? null),
    error,
    appliedFilters,
    appliedSearchValues: state,
    appliedPage,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  };
}
