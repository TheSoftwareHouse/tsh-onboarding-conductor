import {
  buildFilterSearchParams,
  readEnumParam,
  readPageSizeParam,
  readTextParam,
} from '@/shared/lib/filter-search-params';
import { isAuditActorType } from '../types/audit-event';
import { createDefaultAuditEventFilters } from './audit-events-query';
import { normalizeAuditEventFilters, type AuditEventFilters } from './filter-audit-events';

/**
 * Committed filters a URL carries, so a filtered log survives leaving the section and coming back.
 *
 * Both datetimes are carried as the `datetime-local` control values the operator typed rather than
 * as instants, so the controls are restored exactly as they were left. A link therefore names the
 * same wall-clock window wherever it is opened, not the same instant.
 *
 * A criterion the panel itself validates but the URL states badly - an unparseable datetime, or a
 * backwards window - drops the whole set rather than being partly honored, which keeps a
 * hand-edited or stale link from showing criteria in the controls that the results were never
 * narrowed by. Anything else the endpoint refuses is reported as the failed request it is, exactly
 * as it would be for a value the operator typed.
 */
export function readAuditEventFilters(params: URLSearchParams): AuditEventFilters {
  const filters: AuditEventFilters = {
    actorType: readEnumParam(params, 'actorType', isAuditActorType),
    actorId: readTextParam(params, 'actorId'),
    action: readTextParam(params, 'action'),
    resourceType: readTextParam(params, 'resourceType'),
    resourceId: readTextParam(params, 'resourceId'),
    occurredFrom: readTextParam(params, 'occurredFrom'),
    occurredTo: readTextParam(params, 'occurredTo'),
    limit: readPageSizeParam(params),
  };

  return normalizeAuditEventFilters(filters).ok ? filters : createDefaultAuditEventFilters();
}

/** The URL that carries a committed filter set and page, named as the endpoint names them. */
export function buildAuditEventsSearchParams(
  filters: AuditEventFilters,
  page: number,
): URLSearchParams {
  return buildFilterSearchParams(
    {
      actorType: filters.actorType,
      actorId: filters.actorId,
      action: filters.action,
      resourceType: filters.resourceType,
      resourceId: filters.resourceId,
      occurredFrom: filters.occurredFrom,
      occurredTo: filters.occurredTo,
    },
    page,
    filters.limit,
  );
}
