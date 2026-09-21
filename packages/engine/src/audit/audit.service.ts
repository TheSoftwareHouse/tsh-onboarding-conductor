import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import {
  ADMIN_ACCESS_ACTIONS,
  ADMIN_ACCESS_RESOURCE_TYPE,
  ADMIN_ACCESS_UNKNOWN_ACTOR,
  AGREEMENT_AUDIT_RESOURCE_TYPE,
  API_FAILURE_ACTIONS,
  API_FAILURE_RESOURCE_TYPE,
  CONNECTOR_FAILURE_ACTIONS,
  CONNECTOR_FAILURE_RESOURCE_TYPE,
  CONNECTOR_OUTCOME_ACTIONS,
  CONNECTOR_SETTINGS_ACTIONS,
  CONNECTOR_SETTINGS_RESOURCE_TYPE,
  ENCRYPTION_ACTIONS,
  ENCRYPTION_KEY_RESOURCE_TYPE,
  getAuditEntryType,
  isAuditAction,
  ONBOARDING_AUDIT_RESOURCE_TYPE,
  ONBOARDING_REJECTED_ATTEMPT_ACTION,
  WEBHOOK_ACTIONS,
  type AdminAccessAction,
  type AdminAccessActorType,
  type AdminAccessAuditInput,
  type AdminAccessAuditMetadata,
  type AgreementAcceptedAuditMetadata,
  type AgreementAuditAction,
  type AgreementAuditInput,
  type AgreementAuditMetadata,
  type AgreementLinkedAuditMetadata,
  type AgreementVersionPublishedAuditMetadata,
  type ApiFailureAuditAction,
  type ApiFailureAuditInput,
  type ApiFailureAuditMetadata,
  type AuditLifecycleMetadata,
  type AuditOnboardingSnapshot,
  type ConnectorFailureAuditAction,
  type ConnectorFailureAuditInput,
  type ConnectorFailureAuditMetadata,
  type ConnectorOutcomeAuditAction,
  type ConnectorOutcomeAuditInput,
  type ConnectorOutcomeAuditMetadata,
  type ConnectorSettingsAuditAction,
  type ConnectorSettingsAuditInput,
  type ConnectorSettingsAuditMetadata,
  type EncryptionAuditAction,
  type EncryptionAuditInput,
  type EncryptionAuditMetadata,
  type LifecycleAuditInput,
  type RejectedAttemptAuditInput,
  type RejectedAttemptOperation,
  type RejectedAttemptOutcome,
  type RejectedAttemptAuditMetadata,
  type WebhookAction,
  type WebhookAuditInput,
  type OnboardingTransitionAction,
  type WebhookResourceType,
} from './audit.types';
import { toPaginatedMeta } from '../pagination';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

export type { RejectedAttemptOutcome } from './audit.types';

/** One recorded move of an onboarding, with its metadata narrowed to the lifecycle shape. */
export type OnboardingLifecycleEntry = {
  id: string;
  occurredAt: Date;
  action: OnboardingTransitionAction;
  metadata: AuditLifecycleMetadata;
};

export type OnboardingLifecycleTrail = {
  /** Oldest first, which is the order the onboarding moved through them. */
  entries: OnboardingLifecycleEntry[];
  /** True when the onboarding recorded more moves than were read, so the trail starts mid-journey. */
  truncated: boolean;
};

const REJECTED_ATTEMPT_OUTCOME_ALLOWLIST: Record<
  RejectedAttemptOperation,
  readonly RejectedAttemptOutcome[]
> = {
  submit: [
    'onboarding_not_found',
    'onboarding_completed',
    'retryable_invalid_data',
    'unknown_workflow_evaluation',
  ],
  manual_review: [
    'onboarding_not_found',
    'onboarding_completed',
    'unsupported_action',
    'transition_unavailable',
    'unknown_workflow_evaluation',
  ],
};

const WEBHOOK_RESOURCE_ALLOWLIST: Record<WebhookAction, readonly WebhookResourceType[]> = {
  'webhook.inbound_callback_received': ['provider_callback'],
  'webhook.inbound_callback_rejected': ['provider_callback'],
  'webhook.inbound_callback_mapping_failed': ['provider_callback'],
  'webhook.inbound_callback_applied': ['onboarding'],
  'webhook.inbound_signature_skipped': ['provider_callback'],
  'webhook.outbound_notification_suppressed': ['onboarding'],
  'webhook.outbound_notification_dropped': ['onboarding'],
  'webhook.outbound_endpoint_resolution_failed': ['onboarding'],
  'webhook.outbound_intent_created': ['client_webhook_outbox'],
  'webhook.outbound_intent_failed': ['onboarding'],
  'webhook.outbound_delivery_attempted': ['client_webhook_outbox'],
  'webhook.outbound_delivery_succeeded': ['client_webhook_outbox'],
  'webhook.outbound_delivery_failed': ['client_webhook_outbox'],
  'webhook.outbound_resend_requested': ['client_webhook_outbox'],
  'webhook.outbound_resend_not_found': ['client_webhook_outbox'],
  'webhook.outbound_resend_noop': ['client_webhook_outbox'],
  'webhook.outbound_lease_expired': ['client_webhook_outbox'],
  'webhook.outbound_poll_failed': ['client_webhook_outbox'],
  'webhook.outbound_dispatch_failed': ['client_webhook_outbox'],
  'webhook.outbound_queue_job_failed': ['client_webhook_outbox'],
  'webhook.outbound_finalization_noop': ['client_webhook_outbox'],
};

/**
 * Which actor type each admin access outcome may claim. An `access_granted` or `role_missing` row
 * means the token was verified and therefore names a real operator; the rest never got that far
 * and must stay anonymous. Asserting the pairing keeps a coding mistake from attributing an
 * unverified request to a named person.
 */
const ADMIN_ACCESS_ACTOR_ALLOWLIST: Record<AdminAccessAction, AdminAccessActorType> = {
  'auth.access_granted': 'operator',
  'auth.role_missing': 'operator',
  'auth.token_rejected': 'anonymous',
  'auth.verification_unavailable': 'anonymous',
  'auth.access_unauthenticated': 'anonymous',
};

/**
 * Which resource each agreement action is filed against. A publish is about the version itself,
 * so it is the only row in the trail carrying the `agreement` resource type; a link and an
 * acceptance happened to an onboarding and join the rows already filed under it. Doubling as the
 * membership check keeps an invented action string out of the log, like every other allowlist
 * here.
 */
const AGREEMENT_RESOURCE_ALLOWLIST: Partial<Record<AgreementAuditAction, string>> = {
  'agreement.version_published': AGREEMENT_AUDIT_RESOURCE_TYPE,
  'agreement.linked': ONBOARDING_AUDIT_RESOURCE_TYPE,
  'agreement.accepted': ONBOARDING_AUDIT_RESOURCE_TYPE,
};

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async log(manager: EntityManager, input: LifecycleAuditInput): Promise<unknown> {
    const metadata = this.buildMetadata(input);

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: input.action,
      entryType: getAuditEntryType(input.action),
      resourceType: 'onboarding',
      resourceId: this.getResourceId(input),
      metadata: this.filterLifecycleMetadata(metadata),
      before: this.getBeforeSnapshot(input),
      after: this.getAfterSnapshot(input),
      hashPrev: null,
      hashSelf: null,
    });
  }

  async list(manager: EntityManager, query?: ListAuditQueryDto): Promise<ListAuditResponseDto> {
    const result = await this.repository.findByFilters(manager, query);

    return {
      items: result.items.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: this.filterMetadata(row.metadata, row.action),
      })),
      meta: toPaginatedMeta(result),
    };
  }

  /**
   * The moves one onboarding recorded, oldest first and no more than `limit` of them.
   *
   * Reads the audit log rather than a table of its own: the trail is already the record of what
   * happened, and a second one would be a second thing to keep in step. The metadata is narrowed
   * to {@link AuditLifecycleMetadata} here so callers read named fields instead of digging through
   * a bag of unknowns, and is put through the same allowlist as the audit list endpoint so a row
   * written by an older build cannot surface fields this one does not know about.
   */
  async listOnboardingLifecycle(
    manager: EntityManager,
    onboardingId: string,
    limit: number,
  ): Promise<OnboardingLifecycleTrail> {
    const rows = await this.repository.findOnboardingLifecycle(manager, onboardingId, limit);
    const truncated = rows.length > limit;

    return {
      entries: rows
        .slice(0, limit)
        .reverse()
        .map((row) => ({
          id: row.id,
          occurredAt: row.occurredAt,
          action: row.action as OnboardingTransitionAction,
          metadata: this.filterLifecycleMetadata(row.metadata as AuditLifecycleMetadata),
        })),
      truncated,
    };
  }

  async logRejectedAttempt(
    dataSource: DataSource,
    input: RejectedAttemptAuditInput,
  ): Promise<unknown> {
    this.assertRejectedAttemptAllowed(input);
    const metadata: RejectedAttemptAuditMetadata = {
      operation: input.operation,
      outcome: input.outcome,
    };

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'system',
        actorId: 'engine',
        action: ONBOARDING_REJECTED_ATTEMPT_ACTION,
        entryType: getAuditEntryType(ONBOARDING_REJECTED_ATTEMPT_ACTION),
        resourceType: 'onboarding',
        resourceId: input.resourceId,
        metadata,
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  /**
   * Records one access decision on an admin endpoint.
   *
   * Writes in its own transaction rather than joining the caller's, because the guard runs before
   * any request-scoped transaction exists and because a refused request has no other work to
   * commit alongside it.
   */
  async logAdminAccess(dataSource: DataSource, input: AdminAccessAuditInput): Promise<unknown> {
    this.assertAdminAccessAllowed(input);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: input.actorType,
        actorId: input.actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : input.actorId,
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: ADMIN_ACCESS_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterAdminAccessMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  /**
   * Records one credential change made through `/v1/admin/connectors`.
   *
   * Writes in its own transaction, like `logAdminAccess`: the settings write it
   * follows already committed through `ConnectorSettingsService`, so this row has no
   * other work to join. Metadata is limited to `connectorId` and `keys` by
   * {@link ConnectorSettingsAuditMetadata} and re-filtered on the way in — a value, a
   * masked value or the previous value must never reach the trail.
   */
  async logConnectorSettingsChange(
    dataSource: DataSource,
    input: ConnectorSettingsAuditInput,
  ): Promise<unknown> {
    this.assertConnectorSettingsChangeAllowed(input.action);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'operator',
        actorId: input.actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : input.actorId,
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: CONNECTOR_SETTINGS_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterConnectorSettingsMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  /**
   * Records one step of the encryption story: an operator turning encryption on or off, adding a
   * key, the key that add supersedes, or a step of the background sweep.
   *
   * Writes in its own transaction, like `logConnectorSettingsChange` and `logAdminAccess`: every
   * caller invokes this *after* its own write has already committed - the key-ring change through
   * `EncryptionAdminService` or the sweep's batch commit - so a failed audit write here can never
   * roll back a change the caller already made durable. Actor type is carried on the input,
   * unlike the connector-settings family, because this family mixes operator-driven rows with
   * system-driven ones (sweeping) rather than always being one or the other.
   */
  async logEncryption(dataSource: DataSource, input: EncryptionAuditInput): Promise<unknown> {
    this.assertEncryptionAllowed(input.action);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: input.actorType,
        actorId: input.actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : input.actorId,
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: ENCRYPTION_KEY_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterEncryptionMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  /**
   * Records one decision a connector's error handler returned - a retry, a fallback taking over,
   * a swallowed failure, or a propagated one.
   *
   * Writes in its own transaction rather than the caller's: the connector chain runs *inside*
   * `dataSource.transaction(...)` in `OnboardingsService`'s submit flow, and a row written on
   * that manager would be rolled back with the failed submit - losing precisely the
   * `connector.failure_propagated` rows an operator would go looking for.
   */
  async logConnectorFailure(
    dataSource: DataSource,
    input: ConnectorFailureAuditInput,
  ): Promise<unknown> {
    this.assertConnectorFailureAllowed(input.action);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'system',
        actorId: 'engine',
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: CONNECTOR_FAILURE_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterConnectorFailureMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
        stamp: input.stamp,
      }),
    );
  }

  /**
   * Records one connector outcome with no error-handler decision behind it - a pre-chain failure
   * that never reached the handler chain, or a non-accepted result an adapter returned instead of
   * throwing. Writes in its own transaction, like `logConnectorFailure` and for the same reason:
   * the executor runs inside the submit's transaction, and a row on that manager would be rolled
   * back with the failed submit.
   */
  async logConnectorOutcome(
    dataSource: DataSource,
    input: ConnectorOutcomeAuditInput,
  ): Promise<unknown> {
    this.assertConnectorOutcomeAllowed(input.action);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'system',
        actorId: 'engine',
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: CONNECTOR_FAILURE_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterConnectorOutcomeMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
        stamp: input.stamp,
      }),
    );
  }

  /**
   * Records one rejected or unhandled response on the `/v1` HTTP surface. Writes in its own
   * transaction and with a required `stamp`, like `logConnectorFailure`: the global exception
   * filter schedules this write fire-and-forget rather than joining the failed request's own
   * transaction, which may itself be what is rolling back.
   */
  async logApiFailure(dataSource: DataSource, input: ApiFailureAuditInput): Promise<unknown> {
    this.assertApiFailureAllowed(input.action);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: input.actorType,
        actorId: input.actorId,
        action: input.action,
        entryType: getAuditEntryType(input.action),
        resourceType: API_FAILURE_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterApiFailureMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
        stamp: input.stamp,
      }),
    );
  }

  /**
   * Records one agreement fact: a version published, a link created, or a link accepted.
   *
   * Writes on the caller's manager rather than opening a transaction of its own, unlike the
   * connector families above. Every one of these rows accompanies a write that must stand or fall
   * with it - a publish's fan-out, the links an onboarding start creates, the acceptance a submit
   * applies - so a row surviving a rolled-back link would claim an agreement nobody owes.
   *
   * The actor differs by action rather than by caller: a publish is an operator's act and names
   * them, while a link and an acceptance are steps the engine took carrying out a flow.
   */
  async logAgreement(manager: EntityManager, input: AgreementAuditInput): Promise<unknown> {
    const resourceType = this.getAgreementResourceType(input.action);
    const actor =
      input.action === 'agreement.version_published'
        ? {
            actorType: 'operator',
            actorId: input.actorId === '' ? ADMIN_ACCESS_UNKNOWN_ACTOR : input.actorId,
          }
        : { actorType: 'system', actorId: 'engine' };

    return this.repository.insert(manager, {
      actorType: actor.actorType,
      actorId: actor.actorId,
      action: input.action,
      entryType: getAuditEntryType(input.action),
      resourceType,
      resourceId: input.resourceId,
      metadata: this.filterAgreementMetadata(input.action, input.metadata),
      before: null,
      after: null,
      hashPrev: null,
      hashSelf: null,
    });
  }

  async logWebhook(manager: EntityManager, input: WebhookAuditInput): Promise<unknown> {
    this.assertWebhookAllowed(input);

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: input.action,
      entryType: getAuditEntryType(input.action),
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      metadata: this.buildWebhookMetadata(input),
      before: null,
      after: null,
      hashPrev: null,
      hashSelf: null,
    });
  }

  private buildMetadata(input: LifecycleAuditInput): AuditLifecycleMetadata {
    if (input.action === 'onboarding.started') {
      return {
        workflowId: input.onboarding.workflowId,
        workflowVersion: input.onboarding.workflowVersion,
        appliedStep: input.appliedStep,
        fromStatus: null,
        toStatus: input.onboarding.status,
        fromCurrentStep: null,
        toCurrentStep: input.onboarding.currentStep,
        fromScores: null,
        toScores: input.onboarding.scores,
      };
    }

    if (input.action === 'onboarding.state_transition') {
      return {
        workflowId: input.newOnboarding.workflowId,
        workflowVersion: input.newOnboarding.workflowVersion,
        appliedStep: input.appliedStep,
        fromStatus: input.previousOnboarding.status,
        toStatus: input.newOnboarding.status,
        fromCurrentStep: input.previousOnboarding.currentStep,
        toCurrentStep: input.newOnboarding.currentStep,
        fromScores: input.previousOnboarding.scores,
        toScores: input.newOnboarding.scores,
      };
    }

    return {
      workflowId: input.newOnboarding.workflowId,
      workflowVersion: input.newOnboarding.workflowVersion,
      appliedStep: input.appliedStep,
      fromStatus: input.previousOnboarding.status,
      toStatus: input.newOnboarding.status,
      fromCurrentStep: input.previousOnboarding.currentStep,
      toCurrentStep: input.newOnboarding.currentStep,
      fromScores: input.previousOnboarding.scores,
      toScores: input.newOnboarding.scores,
      manualTrigger: input.manualTrigger,
    };
  }

  private getResourceId(input: LifecycleAuditInput): string {
    if (input.action === 'onboarding.started') {
      return input.onboarding.id;
    }

    if (input.action === 'onboarding.state_transition') {
      return input.newOnboarding.id;
    }

    return input.newOnboarding.id;
  }

  private getBeforeSnapshot(input: LifecycleAuditInput): AuditOnboardingSnapshot | null {
    if (input.action === 'onboarding.started') {
      return null;
    }

    return this.mapOnboardingSnapshot(input.previousOnboarding);
  }

  private getAfterSnapshot(input: LifecycleAuditInput): AuditOnboardingSnapshot | null {
    if (input.action === 'onboarding.started') {
      return this.mapOnboardingSnapshot(input.onboarding);
    }

    return this.mapOnboardingSnapshot(input.newOnboarding);
  }

  private filterMetadata(
    metadata: Record<string, unknown>,
    action?: string,
  ): Record<string, unknown> {
    if (action !== undefined && this.isWebhookAction(action)) {
      return metadata;
    }

    if (action !== undefined && this.isAdminAccessAction(action)) {
      return this.filterAdminAccessMetadata(metadata as AdminAccessAuditMetadata);
    }

    if (action !== undefined && this.isConnectorSettingsAction(action)) {
      return this.filterConnectorSettingsMetadata(metadata as ConnectorSettingsAuditMetadata);
    }

    if (action !== undefined && this.isConnectorFailureAction(action)) {
      return this.filterConnectorFailureMetadata(metadata as ConnectorFailureAuditMetadata);
    }

    if (action !== undefined && this.isConnectorOutcomeAction(action)) {
      return this.filterConnectorOutcomeMetadata(metadata as ConnectorOutcomeAuditMetadata);
    }

    if (action !== undefined && this.isApiFailureAction(action)) {
      return this.filterApiFailureMetadata(metadata as ApiFailureAuditMetadata);
    }

    if (action !== undefined && this.isAgreementAction(action)) {
      return this.filterAgreementMetadata(action, metadata as AgreementAuditMetadata);
    }

    if (action !== undefined && this.isEncryptionAction(action)) {
      return this.filterEncryptionMetadata(metadata as EncryptionAuditMetadata);
    }

    return this.filterLifecycleMetadata(metadata as AuditLifecycleMetadata);
  }

  private filterLifecycleMetadata(metadata: AuditLifecycleMetadata): AuditLifecycleMetadata {
    const safeMetadata: AuditLifecycleMetadata = {
      workflowId: metadata.workflowId,
      workflowVersion: metadata.workflowVersion,
      appliedStep: metadata.appliedStep,
      fromStatus: metadata.fromStatus,
      toStatus: metadata.toStatus,
      fromCurrentStep: metadata.fromCurrentStep,
      toCurrentStep: metadata.toCurrentStep,
      fromScores: metadata.fromScores,
      toScores: metadata.toScores,
    };

    if (metadata.manualTrigger !== undefined) {
      safeMetadata.manualTrigger = metadata.manualTrigger;
    }

    return safeMetadata;
  }

  private buildWebhookMetadata(input: WebhookAuditInput): Record<string, unknown> {
    return input.metadata;
  }

  /**
   * Allowlists the admin access metadata on the way in and again on the way out, so a row written
   * by an older build — or by hand — cannot surface arbitrary fields through the admin API.
   * Absent keys are dropped rather than stored as `null`, which keeps a refusal row from carrying
   * empty operator fields that read as though an identity had been established.
   */
  private filterAdminAccessMetadata(metadata: AdminAccessAuditMetadata): AdminAccessAuditMetadata {
    const safeMetadata: AdminAccessAuditMetadata = { method: metadata.method };

    if (metadata.tenantId != null) {
      safeMetadata.tenantId = metadata.tenantId;
    }
    if (metadata.userPrincipalName != null) {
      safeMetadata.userPrincipalName = metadata.userPrincipalName;
    }
    if (metadata.grantedRoles !== undefined) {
      safeMetadata.grantedRoles = metadata.grantedRoles;
    }
    if (metadata.requiredRoles !== undefined) {
      safeMetadata.requiredRoles = metadata.requiredRoles;
    }
    if (metadata.reason !== undefined) {
      safeMetadata.reason = metadata.reason;
    }
    if (metadata.tokenIssuer != null) {
      safeMetadata.tokenIssuer = metadata.tokenIssuer;
    }
    if (metadata.tokenAudience != null) {
      safeMetadata.tokenAudience = metadata.tokenAudience;
    }
    if (metadata.tokenVersion != null) {
      safeMetadata.tokenVersion = metadata.tokenVersion;
    }

    return safeMetadata;
  }

  /**
   * Allowlists connector-settings metadata down to key names, both on the way in and
   * again on the way out through the admin list endpoint — the same shape either way,
   * since there is nothing here riskier than a key name to begin with, but a row
   * written by an older build must not surface a field this allowlist does not name.
   */
  private filterConnectorSettingsMetadata(
    metadata: ConnectorSettingsAuditMetadata,
  ): ConnectorSettingsAuditMetadata {
    return { connectorId: metadata.connectorId, keys: metadata.keys };
  }

  /**
   * Allowlists encryption metadata both on the way in and again on the way out through the admin
   * list endpoint, mirroring `filterAdminAccessMetadata`'s style. Optional fields are dropped
   * rather than stored as `null` - a `key_added` row never carries `rowsMoved`, and a successful
   * sweep step never carries `reason`. There is no field here shaped like a key, so a caller
   * cannot smuggle wrapped or unwrapped material through this filter even by constructing the
   * input by hand.
   */
  private filterEncryptionMetadata(metadata: EncryptionAuditMetadata): EncryptionAuditMetadata {
    const safeMetadata: EncryptionAuditMetadata = {};

    if (metadata.keyId !== undefined) {
      safeMetadata.keyId = metadata.keyId;
    }
    if (metadata.supersededKeyId !== undefined) {
      safeMetadata.supersededKeyId = metadata.supersededKeyId;
    }
    if (metadata.rowsMoved !== undefined) {
      safeMetadata.rowsMoved = metadata.rowsMoved;
    }
    if (metadata.onboardingId !== undefined) {
      safeMetadata.onboardingId = metadata.onboardingId;
    }
    if (metadata.reason !== undefined) {
      safeMetadata.reason = metadata.reason;
    }

    return safeMetadata;
  }

  /**
   * Allowlists agreement metadata on the way in and again on the way out, like every other
   * family. The publish row names the family and how far the fan-out reached; a link or an
   * acceptance names the version and what caused it. Nothing here carries the agreement's content
   * - the engine never holds it - so the allowlist exists to keep a row written by an older build
   * from surfacing a field this one does not know about.
   */
  private filterAgreementMetadata(
    action: AgreementAuditAction,
    metadata: AgreementAuditMetadata,
  ): AgreementAuditMetadata {
    if (action === 'agreement.version_published') {
      const published = metadata as AgreementVersionPublishedAuditMetadata;

      return {
        key: published.key,
        type: published.type,
        version: published.version,
        linkedOnboardings: published.linkedOnboardings,
      };
    }

    const link = metadata as AgreementLinkedAuditMetadata | AgreementAcceptedAuditMetadata;

    return {
      agreementId: link.agreementId,
      key: link.key,
      version: link.version,
      origin: link.origin,
    } as AgreementLinkedAuditMetadata | AgreementAcceptedAuditMetadata;
  }

  /**
   * Allowlists connector-failure metadata both on the way in and again on the way out through
   * the admin list endpoint, mirroring `filterAdminAccessMetadata`'s style. Optional fields are
   * dropped rather than stored as `null`. There is no message field to allowlist away: the type
   * only ever carries `errorName`, so a caller cannot smuggle exception text through this filter
   * even by constructing the input by hand.
   */
  private filterConnectorFailureMetadata(
    metadata: ConnectorFailureAuditMetadata,
  ): ConnectorFailureAuditMetadata {
    const safeMetadata: ConnectorFailureAuditMetadata = {
      stepName: metadata.stepName,
      connectorId: metadata.connectorId,
      connectorName: metadata.connectorName,
      connectorOrder: metadata.connectorOrder,
      errorHandler: metadata.errorHandler,
      attempt: metadata.attempt,
      errorName: metadata.errorName,
    };

    if (metadata.status !== undefined) {
      safeMetadata.status = metadata.status;
    }
    if (metadata.fallbackConnectorId !== undefined) {
      safeMetadata.fallbackConnectorId = metadata.fallbackConnectorId;
    }
    if (metadata.fallbackConnectorName !== undefined) {
      safeMetadata.fallbackConnectorName = metadata.fallbackConnectorName;
    }
    if (metadata.fallbackPosition !== undefined) {
      safeMetadata.fallbackPosition = metadata.fallbackPosition;
    }
    if (metadata.retryDelayMs !== undefined) {
      safeMetadata.retryDelayMs = metadata.retryDelayMs;
    }
    if (metadata.override !== undefined) {
      safeMetadata.override = metadata.override;
    }

    return safeMetadata;
  }

  /**
   * Allowlists connector-outcome metadata both on the way in and again on the way out through the
   * admin list endpoint, mirroring `filterConnectorFailureMetadata`'s style. Optional fields are
   * dropped rather than stored as `null` or a placeholder - a pre-chain failure never has a
   * `reason` or `fieldErrors`, and a non-accepted result never has an `errorName`.
   */
  private filterConnectorOutcomeMetadata(
    metadata: ConnectorOutcomeAuditMetadata,
  ): ConnectorOutcomeAuditMetadata {
    const safeMetadata: ConnectorOutcomeAuditMetadata = {
      stepName: metadata.stepName,
      connectorId: metadata.connectorId,
      connectorName: metadata.connectorName,
    };

    if (metadata.connectorOrder !== undefined) {
      safeMetadata.connectorOrder = metadata.connectorOrder;
    }
    if (metadata.errorName !== undefined) {
      safeMetadata.errorName = metadata.errorName;
    }
    if (metadata.reason !== undefined) {
      safeMetadata.reason = metadata.reason;
    }
    if (metadata.fieldErrors !== undefined) {
      safeMetadata.fieldErrors = metadata.fieldErrors;
    }

    return safeMetadata;
  }

  /**
   * Allowlists api-failure metadata both on the way in and again on the way out through the admin
   * list endpoint, mirroring `filterAdminAccessMetadata`'s style. There is no message field to
   * allowlist away: the type only ever carries `errorName` and structured, value-free
   * `fieldErrors`, so a caller cannot smuggle exception text, a request body or a header through
   * this filter even by constructing the input by hand.
   */
  private filterApiFailureMetadata(metadata: ApiFailureAuditMetadata): ApiFailureAuditMetadata {
    const safeMetadata: ApiFailureAuditMetadata = {
      method: metadata.method,
      route: metadata.route,
      status: metadata.status,
      code: metadata.code,
      errorName: metadata.errorName,
    };

    if (metadata.routeParams !== undefined) {
      safeMetadata.routeParams = metadata.routeParams;
    }
    if (metadata.fieldErrors !== undefined) {
      safeMetadata.fieldErrors = metadata.fieldErrors;
    }

    return safeMetadata;
  }

  private mapOnboardingSnapshot(onboarding: AuditOnboardingSnapshot): AuditOnboardingSnapshot {
    return {
      id: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      scores: onboarding.scores,
    };
  }

  private assertRejectedAttemptAllowed(input: RejectedAttemptAuditInput): void {
    const outcomes = REJECTED_ATTEMPT_OUTCOME_ALLOWLIST[input.operation];

    if (!outcomes.includes(input.outcome)) {
      throw new Error(`Unsupported rejected-attempt mapping: ${input.operation}:${input.outcome}`);
    }
  }

  private assertWebhookAllowed(input: WebhookAuditInput): void {
    const allowedResources = WEBHOOK_RESOURCE_ALLOWLIST[input.action];
    const allowedResource = allowedResources?.[0];

    if (allowedResources === undefined || !allowedResources.includes(input.resourceType)) {
      throw new Error(
        `Unsupported webhook audit mapping: ${input.action}:${allowedResource}/${input.resourceType}`,
      );
    }
  }

  private assertAdminAccessAllowed(input: AdminAccessAuditInput): void {
    const allowedActorType = ADMIN_ACCESS_ACTOR_ALLOWLIST[input.action];

    if (allowedActorType === undefined) {
      throw new Error(`Unsupported admin access audit action: ${input.action}`);
    }

    if (allowedActorType !== input.actorType) {
      throw new Error(
        `Unsupported admin access audit mapping: ${input.action} must be recorded as ${allowedActorType}, not ${input.actorType}`,
      );
    }
  }

  private assertConnectorSettingsChangeAllowed(action: ConnectorSettingsAuditAction): void {
    if (!isAuditAction(CONNECTOR_SETTINGS_ACTIONS, action)) {
      throw new Error(`Unsupported connector settings audit action: ${action}`);
    }
  }

  private assertEncryptionAllowed(action: EncryptionAuditAction): void {
    if (!isAuditAction(ENCRYPTION_ACTIONS, action)) {
      throw new Error(`Unsupported encryption audit action: ${action}`);
    }
  }

  private assertConnectorFailureAllowed(action: ConnectorFailureAuditAction): void {
    if (!isAuditAction(CONNECTOR_FAILURE_ACTIONS, action)) {
      throw new Error(`Unsupported connector failure audit action: ${action}`);
    }
  }

  private assertConnectorOutcomeAllowed(action: ConnectorOutcomeAuditAction): void {
    if (!isAuditAction(CONNECTOR_OUTCOME_ACTIONS, action)) {
      throw new Error(`Unsupported connector outcome audit action: ${action}`);
    }
  }

  private assertApiFailureAllowed(action: ApiFailureAuditAction): void {
    if (!isAuditAction(API_FAILURE_ACTIONS, action)) {
      throw new Error(`Unsupported api failure audit action: ${action}`);
    }
  }

  private getAgreementResourceType(action: AgreementAuditAction): string {
    const resourceType = AGREEMENT_RESOURCE_ALLOWLIST[action];

    if (resourceType === undefined) {
      throw new Error(`Unsupported agreement audit action: ${action}`);
    }

    return resourceType;
  }

  private isWebhookAction(action: string): action is WebhookAction {
    return isAuditAction(WEBHOOK_ACTIONS, action);
  }

  private isAdminAccessAction(action: string): action is AdminAccessAction {
    return isAuditAction(ADMIN_ACCESS_ACTIONS, action);
  }

  private isConnectorSettingsAction(action: string): action is ConnectorSettingsAuditAction {
    return isAuditAction(CONNECTOR_SETTINGS_ACTIONS, action);
  }

  private isConnectorFailureAction(action: string): action is ConnectorFailureAuditAction {
    return isAuditAction(CONNECTOR_FAILURE_ACTIONS, action);
  }

  private isConnectorOutcomeAction(action: string): action is ConnectorOutcomeAuditAction {
    return isAuditAction(CONNECTOR_OUTCOME_ACTIONS, action);
  }

  private isApiFailureAction(action: string): action is ApiFailureAuditAction {
    return isAuditAction(API_FAILURE_ACTIONS, action);
  }

  private isAgreementAction(action: string): action is AgreementAuditAction {
    return Object.prototype.hasOwnProperty.call(AGREEMENT_RESOURCE_ALLOWLIST, action);
  }

  private isEncryptionAction(action: string): action is EncryptionAuditAction {
    return isAuditAction(ENCRYPTION_ACTIONS, action);
  }
}
