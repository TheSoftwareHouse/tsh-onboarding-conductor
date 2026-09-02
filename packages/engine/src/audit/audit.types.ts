import { generateUuidV7 } from '../utils/uuid.util';

/**
 * When an audited event happened, and the identity the trail is ordered by, both taken at that
 * moment rather than when the row is written.
 *
 * Rows are read back in `occurred_at, id` order. A caller whose write is deferred past the event -
 * the connector executor schedules its writes instead of awaiting them, so several are in flight
 * at once - would otherwise have both columns filled whenever its write happened to reach the
 * database, putting concurrent writes in the trail in whatever order they won the race. Stamping
 * at the event restores the order things actually happened in: `occurred_at` to the millisecond,
 * and a UUIDv7 `id` - monotonic within a single millisecond - to separate events sharing one.
 */
export type AuditEventStamp = {
  id: string;
  occurredAt: Date;
};

export const stampAuditEvent = (): AuditEventStamp => ({
  id: generateUuidV7(),
  occurredAt: new Date(),
});

export type RejectedAttemptOperation = 'submit' | 'manual_review';
export type RejectedAttemptOutcome =
  | 'onboarding_not_found'
  | 'onboarding_completed'
  | 'retryable_invalid_data'
  | 'unknown_workflow_evaluation'
  | 'unsupported_action'
  | 'transition_unavailable';

export type RejectedAttemptAuditInput = {
  operation: RejectedAttemptOperation;
  outcome: RejectedAttemptOutcome;
  resourceId: string;
};

export type AuditOnboardingSnapshot = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
};

export type AuditLifecycleMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string | null;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
  manualTrigger?: string;
};

export type RejectedAttemptAuditMetadata = {
  operation: RejectedAttemptOperation;
  outcome: RejectedAttemptOutcome;
};

/** The onboarding resource every lifecycle row is filed under. */
export const ONBOARDING_AUDIT_RESOURCE_TYPE = 'onboarding';

/**
 * The lifecycle actions that record a state the onboarding entered, oldest concern first. Every
 * other row filed against an onboarding - a rejected attempt, a webhook delivery, a connector
 * failure decision - describes something that happened to it rather than a state it moved into,
 * so a reader reconstructing the journey reads only these.
 */
export const ONBOARDING_TRANSITION_ACTIONS = [
  'onboarding.started',
  'onboarding.state_transition',
  'onboarding.manual_review_decision',
] as const;

export type OnboardingTransitionAction = (typeof ONBOARDING_TRANSITION_ACTIONS)[number];

export type LifecycleAuditInput =
  | {
      action: 'onboarding.started';
      onboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.state_transition';
      previousOnboarding: AuditOnboardingSnapshot;
      newOnboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.manual_review_decision';
      previousOnboarding: AuditOnboardingSnapshot;
      newOnboarding: AuditOnboardingSnapshot;
      appliedStep: string | null;
      manualTrigger: string;
    };

export type WebhookAction =
  | 'webhook.inbound_callback_received'
  | 'webhook.inbound_callback_rejected'
  | 'webhook.inbound_callback_mapping_failed'
  | 'webhook.inbound_callback_applied'
  | 'webhook.outbound_notification_suppressed'
  | 'webhook.outbound_endpoint_resolution_failed'
  | 'webhook.outbound_intent_created'
  | 'webhook.outbound_delivery_attempted'
  | 'webhook.outbound_delivery_succeeded'
  | 'webhook.outbound_delivery_failed'
  | 'webhook.outbound_resend_requested'
  | 'webhook.outbound_resend_not_found'
  | 'webhook.outbound_resend_noop';

export type WebhookResourceType = 'provider_callback' | 'onboarding' | 'client_webhook_outbox';

/**
 * Access decisions on the admin read endpoints. Recorded for successes as well as refusals: the
 * question an auditor asks is usually "who read this data", which only the success rows answer.
 *
 * Namespaced `auth.` rather than `admin.` because, as with `webhook.`, the prefix names the
 * subsystem that emitted the event. Which surface it concerns is already carried by
 * `resource_type` (`admin_endpoint`) and `resource_id` (the route).
 *
 * `auth.access_unauthenticated` is the local escape hatch (`ADMIN_AUTH_ENABLED=false`) serving
 * admin data with no credential demanded. It should never appear in a deployed environment, and
 * its presence in the trail is itself the finding.
 */
export type AdminAccessAction =
  | 'auth.access_granted'
  | 'auth.token_rejected'
  | 'auth.role_missing'
  | 'auth.verification_unavailable'
  | 'auth.access_unauthenticated';

/** `operator` is a named human from the directory; `anonymous` is a caller who never got that far. */
export type AdminAccessActorType = 'operator' | 'anonymous';

export const ADMIN_ACCESS_RESOURCE_TYPE = 'admin_endpoint';

/** Stands in for `actorId` when no verified identity was established. */
export const ADMIN_ACCESS_UNKNOWN_ACTOR = 'unknown';

export type AdminAccessAuditMetadata = {
  method: string;
  tenantId?: string | null;
  userPrincipalName?: string | null;
  grantedRoles?: readonly string[];
  requiredRoles?: readonly string[];
  reason?: string;
  tokenIssuer?: string | null;
  tokenAudience?: string | null;
  tokenVersion?: string | null;
};

export type AdminAccessAuditInput = {
  action: AdminAccessAction;
  actorType: AdminAccessActorType;
  actorId: string;
  /** The admin route that was reached for, without its query string. */
  resourceId: string;
  metadata: AdminAccessAuditMetadata;
};

export type WebhookAuditInput = {
  action: WebhookAction;
  resourceType: WebhookResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
};

/**
 * A credential change on `/v1/admin/connectors`. The pair covers the two writes the
 * settings store supports — replacing the stored map and dropping it — mirroring the
 * `PUT` / `DELETE` verbs on the route.
 */
export type ConnectorSettingsAuditAction =
  'connector_settings.updated' | 'connector_settings.deleted';

export const CONNECTOR_SETTINGS_RESOURCE_TYPE = 'connector_settings';

/**
 * Never a value, masked or otherwise, and never the previous value — a credential must
 * not be reconstructible from the audit trail. `keys` names only which settings a write
 * touched, never what they were set to.
 */
export type ConnectorSettingsAuditMetadata = {
  connectorId: string;
  keys: readonly string[];
};

export type ConnectorSettingsAuditInput = {
  action: ConnectorSettingsAuditAction;
  /** The operator who made the change, or the unknown-actor constant. */
  actorId: string;
  resourceId: string;
  metadata: ConnectorSettingsAuditMetadata;
};

/**
 * One decision a connector's error handler returned: a retry, a fallback taking over, a
 * swallowed failure, or a propagated one. Recorded for `PROPAGATE` too - a decision the engine
 * made on its own initiative belongs in the trail whether or not the connector chain recovered.
 */
export type ConnectorFailureAuditAction =
  | 'connector.failure_retried'
  | 'connector.failure_fell_back'
  | 'connector.failure_ignored'
  | 'connector.failure_propagated';

/** These rows are filed against the onboarding they happened to, reusing the same resource type. */
export const CONNECTOR_FAILURE_RESOURCE_TYPE = ONBOARDING_AUDIT_RESOURCE_TYPE;

export type ConnectorFailureAuditMetadata = {
  stepName: string;
  /** The connector that failed - "A" in "fell back from A to B". */
  connectorId: string;
  connectorName: string;
  connectorOrder: number;
  /** The handler that decided, so the trail shows which policy was in force. */
  errorHandler: string;
  attempt: number;
  /** The status the error carried, when it was an `HttpException`. */
  status?: number;
  /** The error's class name only - never its message. See the data boundary in the audit contract. */
  errorName: string;
  /** Present on `connector.failure_fell_back` - "B". */
  fallbackConnectorId?: string;
  fallbackConnectorName?: string;
  /** Present on `connector.failure_fell_back` - B's 1-based position in the declared chain. */
  fallbackPosition?: number;
  /** Present on `connector.failure_retried` when the slot waited before repeating the call. */
  retryDelayMs?: number;
  /**
   * Present when the executor did not act on the handler's decision: `attempts_exhausted` past
   * the declaration's own attempt cap, `retry_delay_budget_exhausted` past the slot's waiting
   * budget, `fallback_unavailable` when a handler fell back to nothing, or
   * `invalid_handler_action` when it returned a value outside the four contract actions.
   */
  override?: string;
};

export type ConnectorFailureAuditInput = {
  action: ConnectorFailureAuditAction;
  resourceId: string;
  metadata: ConnectorFailureAuditMetadata;
  /** Required here, not optional as on the insert: this row's write is deferred past its event. */
  stamp: AuditEventStamp;
};
