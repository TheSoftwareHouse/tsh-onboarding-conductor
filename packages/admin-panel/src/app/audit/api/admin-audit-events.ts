import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { createPaginatedResponseSchema } from '@/services/api/paginated-response';
import { periodStartInstant } from '@/lib/datetime-period';
import type { PaginationWindow } from '@/lib/pagination';
import { AUDIT_ENDPOINTS } from '../constants/endpoints';
import type { AuditEvent } from '../types/audit-event';
import type { AuditEventQueryFilters } from '../utils/filter-audit-events';

const auditEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  // Actor, action and resource types are accepted as any non-empty string. The audit trail is
  // append-only history: pinning these to literal unions would let one row written by another
  // build reject the whole page and leave the operator with no trail at all.
  actorType: z.string().min(1),
  actorId: z.string(),
  action: z.string().min(1),
  resourceType: z.string().min(1),
  resourceId: z.string(),
  metadata: z.record(z.unknown()),
});

const listAuditEventsResponseSchema = createPaginatedResponseSchema(auditEventSchema);

export type AuditEventsFetchErrorReason = 'request-failed' | 'invalid-payload';

export class AuditEventsFetchError extends Error {
  readonly reason: AuditEventsFetchErrorReason;
  readonly status?: number;

  constructor(reason: AuditEventsFetchErrorReason, message: string, status?: number) {
    super(message);
    this.name = 'AuditEventsFetchError';
    this.reason = reason;
    this.status = status;
  }
}

export interface AuditEventsPage {
  events: AuditEvent[];
  pagination: PaginationWindow;
}

/** Projects a validated record onto exactly the eight fields the table renders. */
function projectAuditEvent(record: z.infer<typeof auditEventSchema>): AuditEvent {
  return {
    id: record.id,
    occurredAt: record.occurredAt,
    actorType: record.actorType,
    actorId: record.actorId,
    action: record.action,
    resourceType: record.resourceType,
    resourceId: record.resourceId,
    metadata: record.metadata,
  };
}

/**
 * Request parameters for one page: the filters as-is, with a relative period resolved into the
 * `occurredFrom` instant the endpoint accepts. Every other absent criterion is already `null` in
 * `filters` and needs no filtering here - axios drops a `null` param on its own.
 */
function toRequestParams(filters: AuditEventQueryFilters): Record<string, unknown> {
  const { occurredPeriod, ...params } = filters;
  if (occurredPeriod === null) {
    return params;
  }

  // Resolved here, at the moment the request goes out, rather than when the criterion was
  // committed - that is what makes `Last hour` name the hour ending now rather than the hour
  // ending whenever the operator chose it. The endpoint knows only instants.
  return { ...params, occurredFrom: periodStartInstant(occurredPeriod) };
}

/**
 * Fetches one page of the admin audit trail from the configured engine origin. The filters are
 * already normalized by the caller (every criterion either a real value or `null`, datetimes
 * converted to ISO-8601) apart from a relative period, which only this layer can resolve. It
 * issues one GET request, validates the payload against the Zod schema, and returns the events
 * together with the page window the endpoint reported.
 */
export async function fetchAuditEvents(filters: AuditEventQueryFilters): Promise<AuditEventsPage> {
  let response;
  try {
    response = await httpClient.get<unknown>(AUDIT_ENDPOINTS.adminAuditEvents, {
      params: toRequestParams(filters),
    });
  } catch (cause) {
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new AuditEventsFetchError(
      'request-failed',
      describeRequestFailure(status, cause, 'the audit log'),
      status,
    );
  }

  const parsedPayload = listAuditEventsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw new AuditEventsFetchError(
      'invalid-payload',
      'Response contains a malformed audit event.',
    );
  }

  return {
    events: parsedPayload.data.items.map(projectAuditEvent),
    pagination: parsedPayload.data.meta.pagination,
  };
}
