import { createParser, createSerializer, parseAsStringLiteral, type inferParserType } from 'nuqs';
import { CUSTOM_PERIOD, DATE_TIME_PERIODS, isDateTimePeriod } from '@/lib/datetime-period';
import {
  parseAsTrimmedString,
  parseAsPageNumber,
  parseAsPageSize,
  trimmedOrNull,
} from '@/lib/search-params';
import { AUDIT_ACTOR_TYPES } from '../types/audit-event';
import type { AuditEventFilters } from './filter-audit-events';

/** Rejects a bound the browser's `datetime-local` control could not have produced; anything else passes through unparsed. */
const occurredBoundParser = createParser<string>({
  parse: (value) => (Number.isNaN(new Date(value).getTime()) ? null : value),
  serialize: (value) => value,
});

/** One nuqs parser per Logs criterion — see ADR 0018. `occurredPeriod` never parses `custom`; it is derived. */
export const auditEventsSearchParams = {
  actorType: parseAsStringLiteral(AUDIT_ACTOR_TYPES),
  actorId: parseAsTrimmedString,
  action: parseAsTrimmedString,
  resourceType: parseAsTrimmedString,
  resourceId: parseAsTrimmedString,
  occurredPeriod: parseAsStringLiteral(DATE_TIME_PERIODS),
  occurredFrom: occurredBoundParser,
  occurredTo: occurredBoundParser,
  limit: parseAsPageSize,
  page: parseAsPageNumber,
};

/**
 * State `useQueryStates(auditEventsSearchParams, ...)` reads and writes: also what a committed
 * filter set and page are carried as, and what `toAuditEventQueryFilters` reads.
 */
export type AuditEventsSearchValues = inferParserType<typeof auditEventsSearchParams>;

const serialize = createSerializer(auditEventsSearchParams);

/** Filters as the URL states them, with `occurredPeriod` derived from what is present. */
export function toAuditEventFilters(state: AuditEventsSearchValues): AuditEventFilters {
  const hasBounds = state.occurredFrom !== null || state.occurredTo !== null;

  return {
    actorType: state.actorType ?? '',
    actorId: state.actorId ?? '',
    action: state.action ?? '',
    resourceType: state.resourceType ?? '',
    resourceId: state.resourceId ?? '',
    occurredPeriod: state.occurredPeriod ?? (hasBounds ? CUSTOM_PERIOD : ''),
    occurredFrom: state.occurredFrom ?? '',
    occurredTo: state.occurredTo ?? '',
    limit: state.limit,
  };
}

/**
 * The committed filter set and page, named as `auditEventsSearchParams` names them. Shared by
 * `serializeAuditEventsSearch` and `useAuditEvents`' commit, so a tab link and a committed URL
 * are always built the same way.
 */
export function toAuditEventsSearchValues(
  filters: AuditEventFilters,
  page: number,
): AuditEventsSearchValues {
  const period = isDateTimePeriod(filters.occurredPeriod) ? filters.occurredPeriod : null;
  const custom = filters.occurredPeriod === CUSTOM_PERIOD;

  return {
    actorType: filters.actorType || null,
    actorId: trimmedOrNull(filters.actorId),
    action: trimmedOrNull(filters.action),
    resourceType: trimmedOrNull(filters.resourceType),
    resourceId: trimmedOrNull(filters.resourceId),
    occurredPeriod: period,
    occurredFrom: custom ? trimmedOrNull(filters.occurredFrom) : null,
    occurredTo: custom ? trimmedOrNull(filters.occurredTo) : null,
    limit: filters.limit,
    page,
  };
}

/** Query string a committed filter set and page are carried in, '' when nothing differs from default. */
export function serializeAuditEventsSearch(filters: AuditEventFilters, page: number): string {
  return serialize(toAuditEventsSearchValues(filters, page));
}
