import { countActiveFilters } from '@/lib/count-active-filters';
import {
  CUSTOM_PERIOD,
  isDateTimePeriod,
  type DateTimePeriod,
  type DateTimeRangePeriod,
} from '@/lib/datetime-period';
import { DEFAULT_PAGE, type PageSize } from '@/lib/pagination';
import { isAuditActorType, type AuditActorType } from '../types/audit-event';

export const OCCURRED_AT_ERROR_MESSAGE = 'Enter a valid date and time.';
export const OCCURRED_RANGE_ERROR_MESSAGE = '"Occurred from" must not be later than "Occurred to".';

/**
 * Longest value each free-text criterion may carry, mirroring the endpoint's `MaxLength`
 * constraints so an over-long entry is caught by the input rather than by a 400 response.
 */
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
  /**
   * The window as chosen: a relative period, `custom` for the two bounds below, or '' for none.
   * A period and the bounds are mutually exclusive - only one of them ever narrows a request.
   */
  occurredPeriod: DateTimeRangePeriod;
  /** `datetime-local` control value in the operator's own time zone, or empty. Only read under `custom`. */
  occurredFrom: string;
  occurredTo: string;
  limit: PageSize;
}

export interface AuditEventQueryFilters {
  page: number;
  limit: number;
  actorType?: AuditActorType;
  actorId?: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
  /**
   * Left relative on purpose: the endpoint takes instants, but resolving one here would freeze the
   * window into the query key. `fetchAuditEvents` turns it into `occurredFrom` as the request goes
   * out, so a cached key stays stable while the window it names keeps sliding.
   */
  occurredPeriod?: DateTimePeriod;
  /** ISO-8601 instant, which is the only datetime format the endpoint accepts. */
  occurredFrom?: string;
  occurredTo?: string;
}

export type NormalizeAuditEventFiltersResult =
  | { ok: true; filters: AuditEventQueryFilters }
  | {
      ok: false;
      error: {
        reason: 'invalid-occurred-at' | 'invalid-occurred-range';
        message: string;
      };
    };

/**
 * Converts a `datetime-local` control value, which the browser reports in the operator's own
 * time zone and without an offset, into the ISO-8601 instant the endpoint validates against.
 * Returns null for a value the browser could not have produced.
 */
function toIsoInstant(controlValue: string): string | null {
  const parsed = new Date(controlValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

/**
 * Normalizes draft filter controls into the endpoint's supported query keys.
 * Values are trimmed, blank values are omitted, both datetimes are converted to
 * ISO-8601 instants, and the requested window is checked for being the right way round.
 */
export function normalizeAuditEventFilters(
  filters: AuditEventFilters,
  page: number = DEFAULT_PAGE,
): NormalizeAuditEventFiltersResult {
  const normalized: AuditEventQueryFilters = { page, limit: filters.limit };

  if (isAuditActorType(filters.actorType)) {
    normalized.actorType = filters.actorType;
  }

  const actorId = filters.actorId.trim();
  if (actorId.length > 0) {
    normalized.actorId = actorId;
  }

  const action = filters.action.trim();
  if (action.length > 0) {
    normalized.action = action;
  }

  const resourceType = filters.resourceType.trim();
  if (resourceType.length > 0) {
    normalized.resourceType = resourceType;
  }

  const resourceId = filters.resourceId.trim();
  if (resourceId.length > 0) {
    normalized.resourceId = resourceId;
  }

  // A period states the whole window, so the bounds are neither read nor validated under one.
  if (isDateTimePeriod(filters.occurredPeriod)) {
    normalized.occurredPeriod = filters.occurredPeriod;
    return { ok: true, filters: normalized };
  }

  const occurredFrom = filters.occurredFrom.trim();
  if (occurredFrom.length > 0) {
    const instant = toIsoInstant(occurredFrom);
    if (instant === null) {
      return {
        ok: false,
        error: { reason: 'invalid-occurred-at', message: OCCURRED_AT_ERROR_MESSAGE },
      };
    }
    normalized.occurredFrom = instant;
  }

  const occurredTo = filters.occurredTo.trim();
  if (occurredTo.length > 0) {
    const instant = toIsoInstant(occurredTo);
    if (instant === null) {
      return {
        ok: false,
        error: { reason: 'invalid-occurred-at', message: OCCURRED_AT_ERROR_MESSAGE },
      };
    }
    normalized.occurredTo = instant;
  }

  if (
    normalized.occurredFrom !== undefined &&
    normalized.occurredTo !== undefined &&
    normalized.occurredFrom > normalized.occurredTo
  ) {
    return {
      ok: false,
      error: { reason: 'invalid-occurred-range', message: OCCURRED_RANGE_ERROR_MESSAGE },
    };
  }

  return { ok: true, filters: normalized };
}

/**
 * How many criteria narrow the trail, which is the number the filter band reports.
 *
 * The page window never counts, and neither does `custom`: it is the mode the two bounds are
 * entered in rather than a criterion of its own, so under it the bounds are what narrow the trail
 * and counting all three would claim one more filter than the request carries. A relative period
 * does count, because there it is the only thing stating the window.
 */
export function countActiveAuditFilters(filters: AuditEventFilters): number {
  const ignored: readonly (keyof AuditEventFilters)[] =
    filters.occurredPeriod === CUSTOM_PERIOD ? ['limit', 'occurredPeriod'] : ['limit'];

  return countActiveFilters(filters, ignored);
}
