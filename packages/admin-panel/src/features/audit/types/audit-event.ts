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

/**
 * Whether the actor id identifies anyone. `system` and `anonymous` rows carry a placeholder the
 * engine writes for every such row — `engine` and `ADMIN_ACCESS_UNKNOWN_ACTOR` respectively — so
 * showing it repeats the chip in weaker words instead of naming an actor. An unrecognized actor
 * type keeps its id: a newer build may well record a real one.
 */
export function hasAuditActorIdentity(actorType: string): boolean {
  return actorType !== 'system' && actorType !== 'anonymous';
}

export type AuditActorTone = 'operator' | 'other';

/** Visual emphasis for an actor chip: only an operator (a named human) gets the accent tone. */
export function describeAuditActorTone(actorType: string): AuditActorTone {
  return actorType === 'operator' ? 'operator' : 'other';
}

/**
 * Resource types the engine files audit rows under, mirroring `ONBOARDING_AUDIT_RESOURCE_TYPE`,
 * `WebhookResourceType`, `ADMIN_ACCESS_RESOURCE_TYPE` and `CONNECTOR_SETTINGS_RESOURCE_TYPE` in
 * `packages/engine/src/audit/audit.types.ts`. Kept as a local literal for the same reason as
 * `AUDIT_ACTOR_TYPES`: the engine package does not belong in a browser bundle.
 */
export const AUDIT_RESOURCE_TYPES = [
  'onboarding',
  'client_webhook_outbox',
  'provider_callback',
  'connector_settings',
  'admin_endpoint',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

const RESOURCE_TYPE_LABELS: Record<AuditResourceType, string> = {
  onboarding: 'Onboardings',
  client_webhook_outbox: 'Webhook outbox',
  provider_callback: 'Callbacks',
  connector_settings: 'Connector settings',
  admin_endpoint: 'Admin API',
};

/** Whether the engine defines this resource type, narrowing the string the caller already holds. */
export function isAuditResourceType(resourceType: string): resourceType is AuditResourceType {
  return (AUDIT_RESOURCE_TYPES as readonly string[]).includes(resourceType);
}

/** Human-readable resource type label, falling back to the raw value for an unrecognized one. */
export function describeAuditResourceType(resourceType: string): string {
  return isAuditResourceType(resourceType) ? RESOURCE_TYPE_LABELS[resourceType] : resourceType;
}

const FAILURE_ACTION_SUFFIXES = ['_failed', '_rejected', '_not_found', '_missing', '_unavailable'];

/**
 * `connector.failure_*` never matches these suffixes and stays excluded on purpose:
 * `failure_retried` and `failure_fell_back` are recoveries, not failures, and the four
 * `connector.failure_*` actions can't be told apart by suffix alone. `auth.access_unauthenticated`
 * is excluded too — it is a genuine finding in a deployed environment, but it is every row of a
 * local stack run with `ADMIN_AUTH_ENABLED=false`, so flagging it would paint the whole table red
 * locally.
 */
export function isFailureAuditAction(action: string): boolean {
  return (
    action === 'onboarding.rejected_attempt' ||
    FAILURE_ACTION_SUFFIXES.some((suffix) => action.endsWith(suffix))
  );
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
