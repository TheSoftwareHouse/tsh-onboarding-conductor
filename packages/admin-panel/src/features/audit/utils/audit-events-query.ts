import { DEFAULT_PAGE, DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import {
  normalizeAuditEventFilters,
  type AuditEventFilters,
  type AuditEventQueryFilters,
} from './filter-audit-events';

export const AUDIT_EVENTS_QUERY_KEY_PREFIX = 'admin-audit-events' as const;

/** Canonical React Query key: the endpoint's supported, validated query filters only. */
export type AuditEventsQueryKey = readonly [
  typeof AUDIT_EVENTS_QUERY_KEY_PREFIX,
  AuditEventQueryFilters,
];

/** Draft filter control values reset to "no criteria applied". */
export function createDefaultAuditEventFilters(): AuditEventFilters {
  return {
    actorType: '',
    actorId: '',
    action: '',
    resourceType: '',
    resourceId: '',
    occurredPeriod: '',
    occurredFrom: '',
    occurredTo: '',
    limit: DEFAULT_PAGE_SIZE,
  };
}

/** Trims free-text filter values without validating or omitting blanks. */
export function createTrimmedAuditEventFilters(filters: AuditEventFilters): AuditEventFilters {
  return {
    actorType: filters.actorType,
    actorId: filters.actorId.trim(),
    action: filters.action.trim(),
    resourceType: filters.resourceType.trim(),
    resourceId: filters.resourceId.trim(),
    occurredPeriod: filters.occurredPeriod,
    occurredFrom: filters.occurredFrom.trim(),
    occurredTo: filters.occurredTo.trim(),
    limit: filters.limit,
  };
}

/**
 * Builds the canonical query key from committed filters. Callers are expected to have
 * already validated the filters (the page blocks submission on invalid input), so an
 * invalid datetime collapses to the unfiltered key rather than reaching the network.
 */
export function buildAuditEventsQueryKey(
  filters: AuditEventFilters,
  page: number,
): AuditEventsQueryKey {
  const normalized = normalizeAuditEventFilters(filters, page);
  return [
    AUDIT_EVENTS_QUERY_KEY_PREFIX,
    normalized.ok ? normalized.filters : { page: DEFAULT_PAGE, limit: filters.limit },
  ];
}

/** Structural equality for the normalized query filters embedded in a query key. */
export function areAuditEventQueryFiltersEqual(
  left: AuditEventQueryFilters,
  right: AuditEventQueryFilters,
): boolean {
  return (
    left.page === right.page &&
    left.limit === right.limit &&
    left.actorType === right.actorType &&
    left.actorId === right.actorId &&
    left.action === right.action &&
    left.resourceType === right.resourceType &&
    left.resourceId === right.resourceId &&
    left.occurredPeriod === right.occurredPeriod &&
    left.occurredFrom === right.occurredFrom &&
    left.occurredTo === right.occurredTo
  );
}
