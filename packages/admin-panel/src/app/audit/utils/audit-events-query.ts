import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type { AuditEventsSearchValues } from './audit-events-search-params';
import {
  toAuditEventQueryFilters,
  type AuditEventFilters,
  type AuditEventQueryFilters,
} from './filter-audit-events';

export const AUDIT_EVENTS_QUERY_KEY_PREFIX = 'admin-audit-events' as const;

/** Canonical React Query key: the endpoint's supported, validated query filters only. */
export type AuditEventsQueryKey = readonly [
  typeof AUDIT_EVENTS_QUERY_KEY_PREFIX,
  AuditEventQueryFilters,
];

/** Draft filter control values reset to "no criteria applied". Frozen: every consumer shares it. */
export const DEFAULT_AUDIT_EVENT_FILTERS: AuditEventFilters = Object.freeze({
  actorType: '',
  actorId: '',
  action: '',
  resourceType: '',
  resourceId: '',
  occurredPeriod: '',
  occurredFrom: '',
  occurredTo: '',
  limit: DEFAULT_PAGE_SIZE,
});

/** Canonical query key for a committed search state; `toAuditEventQueryFilters` already validates it. */
export function buildAuditEventsQueryKey(state: AuditEventsSearchValues): AuditEventsQueryKey {
  return [AUDIT_EVENTS_QUERY_KEY_PREFIX, toAuditEventQueryFilters(state)];
}
