import { z } from 'zod';
import { ONBOARDING_AUDIT_RESOURCE_TYPE } from '@/lib/audit-search-params';
import { invalidPayloadError, toApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import { createPaginatedResponseSchema } from '@/services/api/paginated-response';
import { periodStartInstant } from '@/lib/datetime-period';
import type { DateTimePeriod } from '@/lib/datetime-period';
import type { PaginationWindow } from '@/lib/pagination';

/** The engine path this module reads, beside the only code that requests it. */
export const ADMIN_AUDIT_ENDPOINT = '/v1/admin/audit';

/**
 * Actor types the engine records, mirroring the literals written by `AuditService`:
 * `system` for engine-driven lifecycle and webhook events, and the two admin-access types
 * from `AdminAccessActorType`. Kept as a local literal because the engine package is a
 * server-side CommonJS build that does not belong in a browser bundle.
 */
export const AUDIT_ACTOR_TYPES = ['system', 'operator', 'anonymous'] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** Whether the engine defines this actor type, narrowing the string the caller already holds. */
export function isAuditActorType(actorType: string): actorType is AuditActorType {
  return (AUDIT_ACTOR_TYPES as readonly string[]).includes(actorType);
}

/**
 * Resource types the engine files audit rows under, mirroring `ONBOARDING_AUDIT_RESOURCE_TYPE`,
 * `WebhookResourceType`, `ADMIN_ACCESS_RESOURCE_TYPE` and `CONNECTOR_SETTINGS_RESOURCE_TYPE` in
 * `packages/engine/src/audit/audit.types.ts`. Kept as a local literal for the same reason as
 * `AUDIT_ACTOR_TYPES`: the engine package does not belong in a browser bundle.
 */
export const AUDIT_RESOURCE_TYPES = [
  ONBOARDING_AUDIT_RESOURCE_TYPE,
  'client_webhook_outbox',
  'provider_callback',
  'connector_settings',
  'admin_endpoint',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

/** Whether the engine defines this resource type, narrowing the string the caller already holds. */
export function isAuditResourceType(resourceType: string): resourceType is AuditResourceType {
  return (AUDIT_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}

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

/** One audit trail entry as returned by the admin audit endpoint. */
export interface AuditEvent {
  id: string;
  occurredAt: string;
  /**
   * Intentionally not narrowed to `AuditActorType`. The audit trail is append-only history, so a
   * row written by an older or newer build must still be displayed rather than rejected.
   */
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  /** Already allowlisted by the engine before it leaves the endpoint. */
  metadata: Record<string, unknown>;
}

export interface AuditEventsPage {
  events: AuditEvent[];
  pagination: PaginationWindow;
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
    response = await httpClient.get<unknown>(ADMIN_AUDIT_ENDPOINT, {
      params: toRequestParams(filters),
    });
  } catch (cause) {
    throw toApiError(cause, 'the audit log');
  }

  const parsedPayload = listAuditEventsResponseSchema.safeParse(response.data);
  if (!parsedPayload.success) {
    throw invalidPayloadError('Response contains a malformed audit event.');
  }

  return {
    events: parsedPayload.data.items.map(projectAuditEvent),
    pagination: parsedPayload.data.meta.pagination,
  };
}
