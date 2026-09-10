import type { ConnectorRejectionReason } from '@tsh/ddl-schema';
import { generateUuidV7 } from '../utils/uuid.util';

/**
 * What kind of record an audit row is, as distinct from `action`, which says what happened.
 *
 * Named `entry_type` rather than `outcome` because `outcome` is already a metadata field on
 * `onboarding.rejected_attempt` and the inbound webhook rows, carrying an unrelated vocabulary
 * (`RejectedAttemptOutcome`); a column of the same name beside it would be a trap.
 *
 * - `success`  — the thing happened as intended.
 * - `rejected` — a deliberate refusal. The system worked; the caller was told no.
 * - `failed`   — something broke.
 * - `observed` — neither: a fact worth recording, such as a delivery that was correctly dropped
 *   or a signature check that was configured off.
 *
 * `rejected` is kept apart from `failed` because a 4xx is not an incident and a 5xx is; folding
 * them together would bury real failures under routine client mistakes.
 */
export const AUDIT_ENTRY_TYPES = ['success', 'rejected', 'failed', 'observed'] as const;

export type AuditEntryType = (typeof AUDIT_ENTRY_TYPES)[number];

/**
 * How every family below declares its actions: one table, one line per action, the entry type
 * that action writes on the same line. The family's action type is the table's keys, so an action
 * cannot exist without a class, and a reader sees the class where the action is declared instead
 * of following it into a separate map.
 */
type AuditActionTable = Record<string, AuditEntryType>;

/** Whether `action` is one this table declares. The membership check every family needs. */
export const isDeclaredAction = <T extends AuditActionTable>(
  table: T,
  action: string,
): action is Extract<keyof T, string> => Object.prototype.hasOwnProperty.call(table, action);

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

/** The one action `logRejectedAttempt` ever writes - named so no call site repeats the literal. */
export const ONBOARDING_REJECTED_ATTEMPT_ACTION = 'onboarding.rejected_attempt';

/** A submit or review the engine refused. The refusal is the correct behaviour, not a failure. */
export const ONBOARDING_REJECTED_ATTEMPT_ENTRY_TYPE: AuditEntryType = 'rejected';

export type AuditOnboardingSnapshot = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
  scores: Record<string, number>;
};

export type AuditLifecycleMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string | null;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
  fromScores: Record<string, number> | null;
  toScores: Record<string, number>;
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
export const ONBOARDING_TRANSITION_ACTIONS = {
  'onboarding.started': 'success',
  'onboarding.state_transition': 'success',
  'onboarding.manual_review_decision': 'success',
} as const satisfies AuditActionTable;

export type OnboardingTransitionAction = keyof typeof ONBOARDING_TRANSITION_ACTIONS;

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

export const WEBHOOK_ACTIONS = {
  // Inbound callbacks.
  'webhook.inbound_callback_received': 'success',
  'webhook.inbound_callback_applied': 'success',
  'webhook.inbound_callback_rejected': 'rejected',
  'webhook.inbound_callback_mapping_failed': 'failed',
  /** Verification was configured off for this connector - a fact noted, not a refusal. */
  'webhook.inbound_signature_skipped': 'observed',

  // Outbound delivery.
  'webhook.outbound_intent_created': 'success',
  'webhook.outbound_intent_failed': 'failed',
  'webhook.outbound_delivery_attempted': 'success',
  'webhook.outbound_delivery_succeeded': 'success',
  'webhook.outbound_delivery_failed': 'failed',
  'webhook.outbound_endpoint_resolution_failed': 'failed',
  'webhook.outbound_poll_failed': 'failed',
  'webhook.outbound_dispatch_failed': 'failed',
  'webhook.outbound_queue_job_failed': 'failed',
  'webhook.outbound_lease_expired': 'failed',
  'webhook.outbound_resend_requested': 'success',
  'webhook.outbound_resend_not_found': 'rejected',
  // Correctly deemed undeliverable, or nothing left to write back to: noted, not broken.
  'webhook.outbound_notification_suppressed': 'observed',
  'webhook.outbound_notification_dropped': 'observed',
  'webhook.outbound_resend_noop': 'observed',
  'webhook.outbound_finalization_noop': 'observed',
} as const satisfies AuditActionTable;

export type WebhookAction = keyof typeof WEBHOOK_ACTIONS;

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
export const ADMIN_ACCESS_ACTIONS = {
  'auth.access_granted': 'success',
  'auth.token_rejected': 'rejected',
  'auth.role_missing': 'rejected',
  'auth.verification_unavailable': 'failed',
  /**
   * The local escape hatch serving admin data with no credential demanded. Its presence in the
   * trail is the finding, which is why it is recorded rather than classed as a plain success.
   */
  'auth.access_unauthenticated': 'observed',
} as const satisfies AuditActionTable;

export type AdminAccessAction = keyof typeof ADMIN_ACCESS_ACTIONS;

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
export const CONNECTOR_SETTINGS_ACTIONS = {
  'connector_settings.updated': 'success',
  'connector_settings.deleted': 'success',
} as const satisfies AuditActionTable;

export type ConnectorSettingsAuditAction = keyof typeof CONNECTOR_SETTINGS_ACTIONS;

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
export const CONNECTOR_FAILURE_ACTIONS = {
  // Recovered or not, the call the handler decided about failed.
  'connector.failure_retried': 'failed',
  'connector.failure_fell_back': 'failed',
  'connector.failure_ignored': 'failed',
  'connector.failure_propagated': 'failed',
} as const satisfies AuditActionTable;

export type ConnectorFailureAuditAction = keyof typeof CONNECTOR_FAILURE_ACTIONS;

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

/**
 * A connector outcome that carries no error-handler decision at all - either the failure never
 * reached the handler chain, or the adapter returned a refusal instead of throwing. Kept separate
 * from {@link ConnectorFailureAuditMetadata} rather than folding into it: `attempt`, `errorHandler`
 * and `connectorOrder` are meaningless for a pre-chain failure and would otherwise need a
 * placeholder value the trail could not honestly stand behind.
 */
export const CONNECTOR_OUTCOME_ACTIONS = {
  'connector.execution_unavailable': 'failed',
  // The adapter answered; the answer was a refusal, which is the connector working as intended.
  'connector.result_rejected': 'rejected',
  'connector.result_invalid_data': 'rejected',
} as const satisfies AuditActionTable;

export type ConnectorOutcomeAuditAction = keyof typeof CONNECTOR_OUTCOME_ACTIONS;

export type ConnectorOutcomeAuditMetadata = {
  stepName: string;
  connectorId: string;
  connectorName: string;
  connectorOrder?: number;
  /** Present on `connector.execution_unavailable` - the thrown error's class name, never its message. */
  errorName?: string;
  /** Present on `connector.result_rejected` - the adapter's declared, value-free rejection reason. */
  reason?: ConnectorRejectionReason;
  /** Present on `connector.result_invalid_data` - value-free field -> reason-code map. */
  fieldErrors?: Readonly<Record<string, readonly string[]>>;
};

export type ConnectorOutcomeAuditInput = {
  action: ConnectorOutcomeAuditAction;
  resourceId: string;
  metadata: ConnectorOutcomeAuditMetadata;
  /** Required here, not optional as on the insert: this row's write is deferred past its event. */
  stamp: AuditEventStamp;
};

/**
 * A rejected or unhandled response on the `/v1` HTTP surface, written by the global exception
 * filter. Files under the request, not a domain resource - a 404 is frequently a request naming
 * an id that never existed, so filing the row under that id would invent resources.
 */
export const API_FAILURE_ACTIONS = {
  // A 4xx is the caller being told no, a 5xx is the engine breaking.
  'api.request_rejected': 'rejected',
  'api.request_failed': 'failed',
} as const satisfies AuditActionTable;

export type ApiFailureAuditAction = keyof typeof API_FAILURE_ACTIONS;

/** The request/response surface every `api.*` row is filed under. */
export const API_FAILURE_RESOURCE_TYPE = 'api_endpoint';

/** Field or key name to reason codes only - never the submitted or allowed values themselves. */
export type ApiFailureFieldErrors = Readonly<Record<string, readonly string[]>>;

export type ApiFailureAuditMetadata = {
  method: string;
  /** The matched route template, else the raw path truncated to the column's 255 chars. */
  route: string;
  status: number;
  /** The fixed contract code, when the response payload carried one. */
  code: string | null;
  /** The exception class name - never its message. */
  errorName: string;
  routeParams?: Readonly<Record<string, string>>;
  fieldErrors?: ApiFailureFieldErrors;
};

export type ApiFailureAuditInput = {
  action: ApiFailureAuditAction;
  /** `operator` when the request carried verified admin claims, else `anonymous`. */
  actorType: AdminAccessActorType;
  actorId: string;
  resourceId: string;
  metadata: ApiFailureAuditMetadata;
  /** Required here, not optional as on the insert: this row's write is deferred past its event. */
  stamp: AuditEventStamp;
};
