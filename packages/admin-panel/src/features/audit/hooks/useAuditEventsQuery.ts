import { useQuery } from '@tanstack/react-query';
import {
  fetchAuditEvents,
  type AuditEventsFetchError,
  type AuditEventsPage,
} from '../api/admin-audit-events';
import type { AuditEventsQueryKey } from '../utils/audit-events-query';

export interface UseAuditEventsQueryOptions {
  queryKey: AuditEventsQueryKey;
}

export interface UseAuditEventsQueryResult {
  data: AuditEventsPage | undefined;
  isFetching: boolean;
  isError: boolean;
  error: AuditEventsFetchError | null;
  refetch: () => void;
}

/**
 * Owns the React Query call for one page of the audit trail at a given committed key.
 * The queryFn fetches with the already-normalized query filters embedded in `queryKey[1]`,
 * so the request always matches the cache entry it populates.
 */
export function useAuditEventsQuery({
  queryKey,
}: UseAuditEventsQueryOptions): UseAuditEventsQueryResult {
  const { data, isFetching, isError, error, refetch } = useQuery<
    AuditEventsPage,
    AuditEventsFetchError
  >({
    queryKey,
    queryFn: () => fetchAuditEvents(queryKey[1]),
  });

  return { data, isFetching, isError, error, refetch };
}
