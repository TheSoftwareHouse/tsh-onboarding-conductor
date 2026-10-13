import { queryOptions } from '@tanstack/react-query';
import { fetchAuditEvents, type AuditEventQueryFilters } from './audit-events';

/** Sibling module to `audit-events.ts` on purpose, so `vi.mock('@/api/audit/audit-events')` still intercepts `list`'s cross-module `queryFn` call. */
export const auditQueries = {
  all: () => ['audit'] as const,
  lists: () => [...auditQueries.all(), 'list'] as const,
  list: (filters: AuditEventQueryFilters) =>
    queryOptions({
      queryKey: [...auditQueries.lists(), filters],
      queryFn: () => fetchAuditEvents(filters),
    }),
};
