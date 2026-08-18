/**
 * Actor types the engine records, mirroring the literals written by `AuditService`:
 * `system` for engine-driven lifecycle and webhook events, and the two admin-access types
 * from `AdminAccessActorType`. Kept as a local literal because the engine package is a
 * server-side CommonJS build that does not belong in a browser bundle.
 */
export const AUDIT_ACTOR_TYPES = ['system', 'operator', 'anonymous'] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  system: 'System',
  operator: 'Operator',
  anonymous: 'Anonymous',
};

/** Whether the engine defines this actor type, narrowing the string the caller already holds. */
export function isAuditActorType(actorType: string): actorType is AuditActorType {
  return (AUDIT_ACTOR_TYPES as readonly string[]).includes(actorType);
}

/** Human-readable actor type label, falling back to the raw value for an unrecognized one. */
export function describeAuditActorType(actorType: string): string {
  return isAuditActorType(actorType) ? ACTOR_TYPE_LABELS[actorType] : actorType;
}

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

/** Page window the endpoint reports alongside the returned events. */
export interface AuditPagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
