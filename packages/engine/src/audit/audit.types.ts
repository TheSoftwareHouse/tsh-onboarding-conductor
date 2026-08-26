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
 * other row filed against an onboarding - a rejected attempt, a webhook delivery - describes
 * something that happened to it rather than a state it moved into, so a reader reconstructing the
 * journey reads only these.
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
