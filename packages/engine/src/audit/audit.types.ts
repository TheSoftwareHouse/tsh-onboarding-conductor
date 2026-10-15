import type { ConnectorRejectionReason } from '@tsh/ddl-schema';
import type { AgreementType } from '../agreements/agreement.types';
import type { EncryptionKeyRotationInterval } from '../encryption/encryption-key-rotation';
import type { ConnectorSelectionScope } from '../workflows/domain/connector-selection';
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

/*
 * ---------------------------------------------------------------------------------------------
 * Actions
 *
 * Every action the engine can write, declared as a literal list per subsystem. The list is the
 * vocabulary; the type below it is that vocabulary as a union, so no call site types an action
 * as a bare `string`. Which entry type each one writes is settled once, further down, in
 * {@link AUDIT_ACTION_ENTRY_TYPES} — the actions and the classification are separate statements
 * about the same vocabulary, and keeping them apart lets the classification be checked for
 * completeness against the vocabulary rather than being whatever the lists happened to say.
 * ---------------------------------------------------------------------------------------------
 */

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

/** The one action `logRejectedAttempt` ever writes - named so no call site repeats the literal. */
export const ONBOARDING_REJECTED_ATTEMPT_ACTION = 'onboarding.rejected_attempt';

export type OnboardingRejectedAttemptAction = typeof ONBOARDING_REJECTED_ATTEMPT_ACTION;

/** Inbound provider callbacks, and the outbound deliveries the engine makes to clients. */
export const WEBHOOK_ACTIONS = [
  // Inbound callbacks.
  'webhook.inbound_callback_received',
  'webhook.inbound_callback_applied',
  'webhook.inbound_callback_rejected',
  'webhook.inbound_callback_mapping_failed',
  'webhook.inbound_signature_skipped',

  // Outbound delivery.
  'webhook.outbound_intent_created',
  'webhook.outbound_intent_failed',
  'webhook.outbound_delivery_attempted',
  'webhook.outbound_delivery_succeeded',
  'webhook.outbound_delivery_failed',
  'webhook.outbound_endpoint_resolution_failed',
  'webhook.outbound_poll_failed',
  'webhook.outbound_dispatch_failed',
  'webhook.outbound_queue_job_failed',
  'webhook.outbound_lease_expired',
  'webhook.outbound_resend_requested',
  'webhook.outbound_resend_not_found',
  'webhook.outbound_notification_suppressed',
  'webhook.outbound_notification_dropped',
  'webhook.outbound_resend_noop',
  'webhook.outbound_finalization_noop',
] as const;

export type WebhookAction = (typeof WEBHOOK_ACTIONS)[number];

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
export const ADMIN_ACCESS_ACTIONS = [
  'auth.access_granted',
  'auth.token_rejected',
  'auth.role_missing',
  'auth.verification_unavailable',
  'auth.access_unauthenticated',
] as const;

export type AdminAccessAction = (typeof ADMIN_ACCESS_ACTIONS)[number];

/**
 * A credential change on `/v1/admin/connectors`. The pair covers the two writes the
 * settings store supports — replacing the stored map and dropping it — mirroring the
 * `PUT` / `DELETE` verbs on the route.
 */
export const CONNECTOR_SETTINGS_ACTIONS = [
  'connector_settings.updated',
  'connector_settings.deleted',
] as const;

export type ConnectorSettingsAuditAction = (typeof CONNECTOR_SETTINGS_ACTIONS)[number];

/** An operator binding a workflow step's connector slot to another adapter, or reverting it. */
export const WORKFLOW_ACTIONS = [
  'workflow.connector_selected',
  'workflow.connector_selection_cleared',
] as const;

export type WorkflowAuditAction = (typeof WORKFLOW_ACTIONS)[number];

/**
 * One decision a connector's error handler returned: a retry, a fallback taking over, a
 * swallowed failure, or a propagated one. Recorded for `PROPAGATE` too - a decision the engine
 * made on its own initiative belongs in the trail whether or not the connector chain recovered.
 */
export const CONNECTOR_FAILURE_ACTIONS = [
  'connector.failure_retried',
  'connector.failure_fell_back',
  'connector.failure_ignored',
  'connector.failure_propagated',
] as const;

export type ConnectorFailureAuditAction = (typeof CONNECTOR_FAILURE_ACTIONS)[number];

/**
 * A connector outcome that carries no error-handler decision at all - either the failure never
 * reached the handler chain, or the adapter returned a refusal instead of throwing. Kept apart
 * from {@link CONNECTOR_FAILURE_ACTIONS} because the two carry different metadata: `attempt`,
 * `errorHandler` and `connectorOrder` are meaningless for a pre-chain failure and would otherwise
 * need a placeholder value the trail could not honestly stand behind.
 */
export const CONNECTOR_OUTCOME_ACTIONS = [
  'connector.execution_unavailable',
  'connector.result_rejected',
  'connector.result_invalid_data',
] as const;

export type ConnectorOutcomeAuditAction = (typeof CONNECTOR_OUTCOME_ACTIONS)[number];

/**
 * A rejected or unhandled response on the `/v1` HTTP surface, written by the global exception
 * filter. Files under the request, not a domain resource - a 404 is frequently a request naming
 * an id that never existed, so filing the row under that id would invent resources.
 */
export const API_FAILURE_ACTIONS = ['api.request_rejected', 'api.request_failed'] as const;

export type ApiFailureAuditAction = (typeof API_FAILURE_ACTIONS)[number];

/**
 * The three facts the agreement feature records. Two of them describe work the engine started on
 * its own initiative — the fan-out a publish performs across every onboarding that is now behind,
 * and the links an onboarding start creates — which is why they are audit rows rather than log
 * lines: nothing else in the system records that the engine decided an onboarding owes something.
 */
export const AGREEMENT_AUDIT_ACTIONS = [
  'agreement.version_published',
  'agreement.linked',
  'agreement.accepted',
] as const;

export type AgreementAuditAction = (typeof AGREEMENT_AUDIT_ACTIONS)[number];

/** An operator creating, replacing, deleting or publishing a workflow draft through the admin API (ADR 0034). */
export const WORKFLOW_DRAFT_AUDIT_ACTIONS = [
  'workflow_draft.created',
  'workflow_draft.updated',
  'workflow_draft.deleted',
  'workflow_draft.published',
] as const;

export type WorkflowDraftAuditAction = (typeof WORKFLOW_DRAFT_AUDIT_ACTIONS)[number];

/**
 * An operator asking the engine to read a parked attempt's verdict back from its provider,
 * instead of waiting for the callback. `reconciled` is the verdict applied through the submit
 * path, written where a callback would write `webhook.inbound_callback_applied`; `reconcile_noop`
 * is the ask that changed nothing — the provider had not decided, or the park had moved on.
 */
export const PENDING_CONNECTOR_ACTIONS = [
  'onboarding.pending_connector_reconciled',
  'onboarding.pending_connector_reconcile_noop',
] as const;

export type PendingConnectorAuditAction = (typeof PENDING_CONNECTOR_ACTIONS)[number];

/**
 * The key ring's story: an operator turning encryption on (which creates the first key) or off
 * (which retires the active one), an operator adding a key, the previous key that add
 * supersedes, and the background sweep that moves every row toward the chosen state —
 * `reencryption_*` while it moves rows onto the active key, `decryption_*` while it moves them
 * back to plaintext after encryption was turned off, and an operator choosing how often the
 * engine rotates the key on its own. The two `*_failed` actions are kept apart from the rest
 * because a row the sweep could not move is an incident, not a step in a change that is
 * proceeding as intended.
 *
 * A rotation the schedule produced writes the same `key_added`/`key_superseded` pair an
 * operator's does, told apart by its `actor_type` being `system` — a rotation is a rotation,
 * whoever asked for it.
 */
export const ENCRYPTION_ACTIONS = [
  'encryption.enabled',
  'encryption.disabled',
  'encryption.key_added',
  'encryption.key_superseded',
  'encryption.rotation_schedule_changed',
  'encryption.reencryption_requested',
  'encryption.reencryption_started',
  'encryption.reencryption_completed',
  'encryption.reencryption_failed',
  'encryption.decryption_started',
  'encryption.decryption_completed',
  'encryption.decryption_failed',
] as const;

export type EncryptionAuditAction = (typeof ENCRYPTION_ACTIONS)[number];

/** Every action any part of the engine may write, as one literal union. */
export type AuditAction =
  | OnboardingTransitionAction
  | OnboardingRejectedAttemptAction
  | WebhookAction
  | AdminAccessAction
  | ConnectorSettingsAuditAction
  | WorkflowAuditAction
  | ConnectorFailureAuditAction
  | ConnectorOutcomeAuditAction
  | ApiFailureAuditAction
  | AgreementAuditAction
  | WorkflowDraftAuditAction
  | PendingConnectorAuditAction
  | EncryptionAuditAction;

/**
 * The entry type each action writes, for every action there is.
 *
 * `Record<AuditAction, AuditEntryType>` is what makes this a contract rather than a lookup table
 * that happens to be filled in: an action added to any list above does not compile until it is
 * classified here, and a key here that no list declares does not compile either. Classifying the
 * whole vocabulary in one place is also how the split between `rejected` and `failed` stays
 * honest - the distinction only means anything if every action is held against one reading of it.
 */
export const AUDIT_ACTION_ENTRY_TYPES: Record<AuditAction, AuditEntryType> = {
  // Onboarding lifecycle: a state the onboarding entered, recorded as it entered it.
  'onboarding.started': 'success',
  'onboarding.state_transition': 'success',
  'onboarding.manual_review_decision': 'success',

  /** A submit or review the engine refused. The refusal is the correct behaviour, not a failure. */
  'onboarding.rejected_attempt': 'rejected',

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

  // Admin access decisions.
  'auth.access_granted': 'success',
  'auth.token_rejected': 'rejected',
  'auth.role_missing': 'rejected',
  'auth.verification_unavailable': 'failed',
  /**
   * The local escape hatch serving admin data with no credential demanded. Its presence in the
   * trail is the finding, which is why it is recorded rather than classed as a plain success.
   */
  'auth.access_unauthenticated': 'observed',

  // Connector credential changes.
  'connector_settings.updated': 'success',
  'connector_settings.deleted': 'success',

  // Workflow connector bindings.
  'workflow.connector_selected': 'success',
  'workflow.connector_selection_cleared': 'success',

  // Connector error-handler decisions: recovered or not, the call decided about failed.
  'connector.failure_retried': 'failed',
  'connector.failure_fell_back': 'failed',
  'connector.failure_ignored': 'failed',
  'connector.failure_propagated': 'failed',

  // Connector outcomes with no handler decision behind them.
  'connector.execution_unavailable': 'failed',
  // The adapter answered; the answer was a refusal, which is the connector working as intended.
  'connector.result_rejected': 'rejected',
  'connector.result_invalid_data': 'rejected',

  // HTTP surface: a 4xx is the caller being told no, a 5xx is the engine breaking.
  'api.request_rejected': 'rejected',
  'api.request_failed': 'failed',

  // Agreements: a publish, a link and an acceptance are each work that went through.
  'agreement.version_published': 'success',
  'agreement.linked': 'success',
  'agreement.accepted': 'success',

  // Workflow drafts: each write went through.
  'workflow_draft.created': 'success',
  'workflow_draft.updated': 'success',
  'workflow_draft.deleted': 'success',
  'workflow_draft.published': 'success',
  // An operator's reconcile: the verdict it applied, or the ask that found nothing to apply.
  'onboarding.pending_connector_reconciled': 'success',
  'onboarding.pending_connector_reconcile_noop': 'observed',

  // Encryption: turning it on or off, adding and superseding a key, and each sweep reaching its
  // target all go through as intended.
  'encryption.enabled': 'success',
  'encryption.disabled': 'success',
  'encryption.key_added': 'success',
  'encryption.key_superseded': 'success',
  'encryption.rotation_schedule_changed': 'success',
  'encryption.reencryption_requested': 'success',
  'encryption.reencryption_started': 'success',
  'encryption.reencryption_completed': 'success',
  'encryption.decryption_started': 'success',
  'encryption.decryption_completed': 'success',
  // A row the sweep could not move to the chosen state is an incident, not a routine step.
  'encryption.reencryption_failed': 'failed',
  'encryption.decryption_failed': 'failed',
};

/** The entry type an action writes. Total over {@link AuditAction}, so it never returns nothing. */
export const getAuditEntryType = (action: AuditAction): AuditEntryType =>
  AUDIT_ACTION_ENTRY_TYPES[action];

/** Whether `action` is one of `actions`. The membership check every subsystem needs. */
export const isAuditAction = <T extends AuditAction>(
  actions: readonly T[],
  action: string,
): action is T => (actions as readonly string[]).includes(action);

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
  | 'awaiting_connector'
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

export type WebhookResourceType = 'provider_callback' | 'onboarding' | 'client_webhook_outbox';

export type WebhookAuditInput = {
  action: WebhookAction;
  resourceType: WebhookResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
};

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

export const WORKFLOW_RESOURCE_TYPE = 'workflow';

/** `resourceId` is the workflow key; `connectorId` is `null` when the selection was cleared. */
export type WorkflowConnectorSelectionAuditMetadata = {
  workflowId: string;
  stepName: string;
  connectorId: string | null;
  scope?: ConnectorSelectionScope;
  versions?: { version: number; previousConnectorId: string | null }[];
  /** Rows written before selections were per version carry this instead of `scope` and `versions`. */
  previousConnectorId?: string | null;
};

export type WorkflowAuditInput = {
  action: WorkflowAuditAction;
  /** The operator who made the change, or the unknown-actor constant. */
  actorId: string;
  resourceId: string;
  metadata: WorkflowConnectorSelectionAuditMetadata;
};

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
/** The published version itself is the resource a publish row is filed against. */
export const AGREEMENT_AUDIT_RESOURCE_TYPE = 'agreement';

/**
 * What caused a link to exist: the onboarding's own workflow declaring the family at start, the
 * publish fan-out reaching an onboarding that was already behind, or an operator linking it by
 * hand. Reading the trail, this is the difference between a link the user was always going to be
 * asked for and one the engine imposed on an onboarding already in flight.
 */
export type AgreementLinkOrigin = 'onboarding_start' | 'version_published' | 'manual';

/** What caused a link to flip: the declaring step's acceptance field, or the accept endpoint. */
export type AgreementAcceptOrigin = 'step_submit' | 'manual';

export type AgreementVersionPublishedAuditMetadata = {
  key: string;
  type: AgreementType;
  version: number;
  /** How many onboardings the publish linked — the fan-out's size, as it was decided. */
  linkedOnboardings: number;
};

export type AgreementLinkedAuditMetadata = {
  agreementId: string;
  key: string;
  version: number;
  origin: AgreementLinkOrigin;
};

export type AgreementAcceptedAuditMetadata = {
  agreementId: string;
  key: string;
  version: number;
  origin: AgreementAcceptOrigin;
};

export type AgreementAuditMetadata =
  | AgreementVersionPublishedAuditMetadata
  | AgreementLinkedAuditMetadata
  | AgreementAcceptedAuditMetadata;

/**
 * A publish names the operator who made it; a link and an acceptance are written by the engine as
 * it carries out a flow, so neither carries an actor of its own.
 */
export type AgreementAuditInput =
  | {
      action: 'agreement.version_published';
      /** The operator who published, or the unknown-actor constant. */
      actorId: string;
      /** The published version's id. */
      resourceId: string;
      metadata: AgreementVersionPublishedAuditMetadata;
    }
  | {
      action: 'agreement.linked';
      /** The onboarding the link belongs to. */
      resourceId: string;
      metadata: AgreementLinkedAuditMetadata;
    }
  | {
      action: 'agreement.accepted';
      /** The onboarding the link belongs to. */
      resourceId: string;
      metadata: AgreementAcceptedAuditMetadata;
    };

/** The draft's `workflow_versions` row is the resource every draft row is filed against. */
export const WORKFLOW_VERSION_AUDIT_RESOURCE_TYPE = 'workflow_version';

/** Identifiers only: the document, which may hold connector config, is never logged. */
export type WorkflowDraftAuditMetadata = {
  workflowId: string;
  version: number;
  /** Set only when an update moved the draft to another id or version. */
  previousWorkflowId?: string;
  previousVersion?: number;
};

export type WorkflowDraftAuditInput = {
  action: WorkflowDraftAuditAction;
  /** The operator who made the change, or the unknown-actor constant. */
  actorId: string;
  /** The draft's `workflow_versions` id. */
  resourceId: string;
  metadata: WorkflowDraftAuditMetadata;
};

/** Why a reconcile applied nothing. */
export type PendingConnectorReconcileNoopOutcome = 'still_pending' | 'superseded';

export type PendingConnectorReconciledAuditMetadata = {
  connectorId: string;
  connectorOrder: number;
  providerIdentity: string;
  submittedData: unknown;
  connectorExecutionResult: Record<string, unknown>;
};

export type PendingConnectorReconcileNoopAuditMetadata = {
  connectorId: string;
  connectorOrder: number;
  outcome: PendingConnectorReconcileNoopOutcome;
};

/** Both rows name the operator who asked and file against the onboarding they asked about. */
export type PendingConnectorAuditInput =
  | {
      action: 'onboarding.pending_connector_reconciled';
      actorId: string;
      resourceId: string;
      metadata: PendingConnectorReconciledAuditMetadata;
    }
  | {
      action: 'onboarding.pending_connector_reconcile_noop';
      actorId: string;
      resourceId: string;
      metadata: PendingConnectorReconcileNoopAuditMetadata;
    };

/** The key row every rotation event is filed against. */
export const ENCRYPTION_KEY_RESOURCE_TYPE = 'encryption_key';

/**
 * `operator` names a human acting through the admin API (turning encryption on or off, adding a
 * key); `system` is the engine acting on its own initiative (the background sweep). Kept as an
 * explicit field, unlike the connector-settings family, because this family's actions are a mix
 * of both rather than always one or the other.
 */
export type EncryptionAuditActorType = 'operator' | 'system';

/**
 * Key ids, row ids and counts only, never material. `keyId` names the key an event concerns -
 * the key created, added, retired, or being swept onto or off; `supersededKeyId` names the key a
 * `key_superseded` row replaced. `rowsMoved` is how many rows the sweep's first batch moved when
 * it recorded `*_started`. `onboardingId` and `reason` describe one row a sweep could not move
 * and a value-free name for why. `rotationInterval` is the automatic-rotation schedule an
 * operator chose, `null` for "stop rotating on a schedule" - which is why it is nullable rather
 * than merely optional. There is no field this type could carry that would let wrapped
 * or unwrapped key material reach the trail - the type simply has no slot shaped like a key.
 */
export type EncryptionAuditMetadata = {
  keyId?: string;
  supersededKeyId?: string;
  rowsMoved?: number;
  onboardingId?: string;
  reason?: string;
  rotationInterval?: EncryptionKeyRotationInterval | null;
};

export type EncryptionAuditInput = {
  action: EncryptionAuditAction;
  actorType: EncryptionAuditActorType;
  /** The operator who acted, or the unknown-actor constant; `engine` for a system action. */
  actorId: string;
  resourceId: string;
  metadata: EncryptionAuditMetadata;
};
