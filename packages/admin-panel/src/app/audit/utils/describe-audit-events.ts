import {
  isAuditActorType,
  isAuditResourceType,
  type AuditActorType,
  type AuditResourceType,
} from '@/api/audit/audit-events';

const ACTOR_TYPE_LABELS: Record<AuditActorType, string> = {
  system: 'System',
  operator: 'Operator',
  anonymous: 'Anonymous',
};

/** Human-readable actor type label, falling back to the raw value for an unrecognized one. */
export function describeAuditActorType(actorType: string): string {
  return isAuditActorType(actorType) ? ACTOR_TYPE_LABELS[actorType] : actorType;
}

export type AuditActorTone = 'operator' | 'other';

/** Visual emphasis for an actor chip: only an operator (a named human) gets the accent tone. */
export function describeAuditActorTone(actorType: string): AuditActorTone {
  return actorType === 'operator' ? 'operator' : 'other';
}

/** Whether the actor id identifies anyone, rather than a system/anonymous placeholder. */
export function hasAuditActorIdentity(actorType: string): boolean {
  return actorType !== 'system' && actorType !== 'anonymous';
}

const RESOURCE_TYPE_LABELS: Record<AuditResourceType, string> = {
  onboarding: 'Onboardings',
  client_webhook_outbox: 'Webhook outbox',
  provider_callback: 'Callbacks',
  connector_settings: 'Connector settings',
  admin_endpoint: 'Admin API',
};

/** Human-readable resource type label, falling back to the raw value for an unrecognized one. */
export function describeAuditResourceType(resourceType: string): string {
  return isAuditResourceType(resourceType) ? RESOURCE_TYPE_LABELS[resourceType] : resourceType;
}
