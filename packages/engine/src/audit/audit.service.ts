import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import {
  ADMIN_ACCESS_RESOURCE_TYPE,
  ADMIN_ACCESS_UNKNOWN_ACTOR,
  CONNECTOR_FAILURE_RESOURCE_TYPE,
  CONNECTOR_SETTINGS_RESOURCE_TYPE,
  type AdminAccessAction,
  type AdminAccessActorType,
  type AdminAccessAuditInput,
  type AdminAccessAuditMetadata,
  type AuditLifecycleMetadata,
  type AuditOnboardingSnapshot,
  type ConnectorFailureAuditAction,
  type ConnectorFailureAuditInput,
  type ConnectorFailureAuditMetadata,
  type ConnectorSettingsAuditAction,
  type ConnectorSettingsAuditInput,
  type ConnectorSettingsAuditMetadata,
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
  'webhook.outbound_notification_suppressed': ['onboarding'],
  'webhook.outbound_endpoint_resolution_failed': ['onboarding'],
  'webhook.outbound_intent_created': ['client_webhook_outbox'],
  'webhook.outbound_delivery_attempted': ['client_webhook_outbox'],
  'webhook.outbound_delivery_succeeded': ['client_webhook_outbox'],
  'webhook.outbound_delivery_failed': ['client_webhook_outbox'],
  'webhook.outbound_resend_requested': ['client_webhook_outbox'],
  'webhook.outbound_resend_not_found': ['client_webhook_outbox'],
  'webhook.outbound_resend_noop': ['client_webhook_outbox'],
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
 * Every action this family may record. A plain membership list rather than a mapping
 * to a per-action dimension, because both actions share the one resource type
 * (`CONNECTOR_SETTINGS_RESOURCE_TYPE`) and the one actor type (`operator`) — the
 * assertion exists to stop an invented action string reaching the log, the same as
 * every other allowlist in this file.
 */
const CONNECTOR_SETTINGS_ACTIONS: readonly ConnectorSettingsAuditAction[] = [
  'connector_settings.updated',
  'connector_settings.deleted',
];

/**
 * Every action this family may record - one per decision a connector's error handler can
 * return. A plain membership list, like `CONNECTOR_SETTINGS_ACTIONS`: every action here shares
 * the one resource type (`CONNECTOR_FAILURE_RESOURCE_TYPE`) and the one actor
 * (`system`/`engine`), so the assertion exists only to stop an invented action string reaching
 * the log.
 */
const CONNECTOR_FAILURE_ACTIONS: readonly ConnectorFailureAuditAction[] = [
  'connector.failure_retried',
  'connector.failure_fell_back',
  'connector.failure_ignored',
  'connector.failure_propagated',
];

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async log(manager: EntityManager, input: LifecycleAuditInput): Promise<unknown> {
    const metadata = this.buildMetadata(input);

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: input.action,
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
        action: 'onboarding.rejected_attempt',
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
        resourceType: CONNECTOR_FAILURE_RESOURCE_TYPE,
        resourceId: input.resourceId,
        metadata: this.filterConnectorFailureMetadata(input.metadata),
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  async logWebhook(manager: EntityManager, input: WebhookAuditInput): Promise<unknown> {
    this.assertWebhookAllowed(input);

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: input.action,
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
    if (metadata.override !== undefined) {
      safeMetadata.override = metadata.override;
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
    if (!CONNECTOR_SETTINGS_ACTIONS.includes(action)) {
      throw new Error(`Unsupported connector settings audit action: ${action}`);
    }
  }

  private assertConnectorFailureAllowed(action: ConnectorFailureAuditAction): void {
    if (!CONNECTOR_FAILURE_ACTIONS.includes(action)) {
      throw new Error(`Unsupported connector failure audit action: ${action}`);
    }
  }

  private isWebhookAction(action: string): action is WebhookAction {
    return Object.prototype.hasOwnProperty.call(WEBHOOK_RESOURCE_ALLOWLIST, action);
  }

  private isAdminAccessAction(action: string): action is AdminAccessAction {
    return Object.prototype.hasOwnProperty.call(ADMIN_ACCESS_ACTOR_ALLOWLIST, action);
  }

  private isConnectorSettingsAction(action: string): action is ConnectorSettingsAuditAction {
    return (CONNECTOR_SETTINGS_ACTIONS as readonly string[]).includes(action);
  }

  private isConnectorFailureAction(action: string): action is ConnectorFailureAuditAction {
    return (CONNECTOR_FAILURE_ACTIONS as readonly string[]).includes(action);
  }
}
