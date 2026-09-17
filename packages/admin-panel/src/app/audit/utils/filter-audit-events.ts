import { countActiveFilters } from '@/lib/count-active-filters';
import {
  isDateTimePeriod,
  type DateTimePeriod,
  type DateTimeRangePeriod,
} from '@/lib/datetime-period';
import type { PageSize } from '@/lib/pagination';
import type { AuditActorType } from '../types/audit-event';
import type { AuditEventsSearchValues } from './audit-events-search-params';
import { trimmedOrNull } from '@/lib/search-params';

export const OCCURRED_AT_ERROR_MESSAGE = 'Enter a valid date and time.';
export const OCCURRED_RANGE_ERROR_MESSAGE = '"Occurred from" must not be later than "Occurred to".';

/** Longest value each free-text criterion may carry, mirroring the endpoint's `MaxLength` limits. */
export const AUDIT_FILTER_MAX_LENGTHS = {
  actorId: 255,
  action: 255,
  resourceType: 64,
  resourceId: 255,
} as const;

/** Raw, uncommitted filter control values as entered by the operator. */
export interface AuditEventFilters {
  /** Empty string means "All" (the criterion is disabled). */
  actorType: '' | AuditActorType;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /** A relative period, `custom` for the two bounds below, or '' for none — mutually exclusive. */
  occurredPeriod: DateTimeRangePeriod;
  /** `datetime-local` control value in the operator's own time zone, or empty. Read only under `custom`. */
  occurredFrom: string;
  occurredTo: string;
  limit: PageSize;
}

/** The endpoint's supported query keys; `null` means absent for every criterion — see ADR 0018. */
export interface AuditEventQueryFilters {
  page: number;
  limit: number;
  actorType: AuditActorType | null;
  actorId: string | null;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  /** Left relative so the query key stays stable while the window slides — see ADR 0018. */
  occurredPeriod: DateTimePeriod | null;
  /** ISO-8601 instant, the only datetime format the endpoint accepts. */
  occurredFrom: string | null;
  occurredTo: string | null;
}

/** ISO-8601 instant for a stated bound, or null when the browser could not have produced it. */
function toIsoInstant(bound: string): string | null {
  const parsed = new Date(bound);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/** Why the window cannot be requested, or null when it can. A null bound states no window. */
function findWindowError(from: string | null, to: string | null): string | null {
  const fromInstant = from === null ? null : toIsoInstant(from);
  const toInstant = to === null ? null : toIsoInstant(to);

  if ((from !== null && fromInstant === null) || (to !== null && toInstant === null)) {
    return OCCURRED_AT_ERROR_MESSAGE;
  }

  if (fromInstant !== null && toInstant !== null && fromInstant > toInstant) {
    return OCCURRED_RANGE_ERROR_MESSAGE;
  }

  return null;
}

/**
 * Why the drafted window cannot be requested, or null when it can — read from the controls
 * directly, so the page can report it while the operator is still typing.
 */
export function findOccurredWindowError(filters: AuditEventFilters): string | null {
  if (isDateTimePeriod(filters.occurredPeriod)) {
    return null;
  }

  return findWindowError(trimmedOrNull(filters.occurredFrom), trimmedOrNull(filters.occurredTo));
}

/**
 * The endpoint's supported query keys, built from the search state. A period short-circuits the
 * bounds without validating them; a window `findWindowError` refuses falls back to both bounds
 * absent, leaving every other criterion to still apply.
 */
export function toAuditEventQueryFilters(state: AuditEventsSearchValues): AuditEventQueryFilters {
  // Key order matches the request, not `state`'s own order, so it is written out explicitly.
  const criteria: AuditEventQueryFilters = {
    page: state.page,
    limit: state.limit,
    actorType: state.actorType,
    actorId: state.actorId,
    action: state.action,
    resourceType: state.resourceType,
    resourceId: state.resourceId,
    occurredPeriod: null,
    occurredFrom: null,
    occurredTo: null,
  };

  if (state.occurredPeriod !== null) {
    return { ...criteria, occurredPeriod: state.occurredPeriod };
  }

  if (findWindowError(state.occurredFrom, state.occurredTo) !== null) {
    return criteria;
  }

  return {
    ...criteria,
    occurredFrom: state.occurredFrom === null ? null : toIsoInstant(state.occurredFrom),
    occurredTo: state.occurredTo === null ? null : toIsoInstant(state.occurredTo),
  };
}

/** How many criteria narrow the trail; `page` and `limit` never count. */
export function countActiveAuditFilters(state: AuditEventsSearchValues): number {
  return countActiveFilters(state, ['page', 'limit']);
}
