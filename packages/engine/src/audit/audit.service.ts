import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

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

type LifecycleOnboarding = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
};

type LifecycleMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string | null;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
  manualTrigger?: string;
};

type LifecycleAuditInput =
  | {
      action: 'onboarding.started';
      onboarding: LifecycleOnboarding;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.state_transition';
      previousOnboarding: LifecycleOnboarding;
      newOnboarding: LifecycleOnboarding;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.manual_review_decision';
      previousOnboarding: LifecycleOnboarding;
      newOnboarding: LifecycleOnboarding;
      appliedStep: string | null;
      manualTrigger: string;
    };

type WebhookAction =
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

type WebhookResourceType = 'provider_callback' | 'onboarding' | 'client_webhook_outbox';

type WebhookAuditInput = {
  action: WebhookAction;
  resourceType: WebhookResourceType;
  resourceId: string;
  metadata: Record<string, unknown>;
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
      metadata: this.filterMetadata(metadata),
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
        metadata: this.filterMetadata(row.metadata as Record<string, unknown>, row.action),
      })),
      meta: {
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      },
    };
  }

  async logRejectedAttempt(
    dataSource: DataSource,
    input: RejectedAttemptAuditInput,
  ): Promise<unknown> {
    this.assertRejectedAttemptAllowed(input);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.rejected_attempt',
        resourceType: 'onboarding',
        resourceId: input.resourceId,
        metadata: {
          operation: input.operation,
          outcome: input.outcome,
        },
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

  private buildMetadata(input: LifecycleAuditInput): LifecycleMetadata {
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

  private getBeforeSnapshot(input: LifecycleAuditInput): Record<string, unknown> | null {
    if (input.action === 'onboarding.started') {
      return null;
    }

    return this.mapOnboardingSnapshot(input.previousOnboarding);
  }

  private getAfterSnapshot(input: LifecycleAuditInput): Record<string, unknown> | null {
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

    const safeMetadata: Record<string, unknown> = {
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

  private mapOnboardingSnapshot(onboarding: LifecycleOnboarding): Record<string, unknown> {
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

  private isWebhookAction(action: string): action is WebhookAction {
    return Object.prototype.hasOwnProperty.call(WEBHOOK_RESOURCE_ALLOWLIST, action);
  }
}
