import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import type { ConnectorAdapter } from '../connectors/ports/connector-adapter.port';
import {
  WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT,
  type ConnectorExecutionPort,
} from '../connectors/ports/connector-execution.port';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { generateUuidV7 } from '../utils/uuid.util';
import { Workflow } from '../workflows/domain/workflow';
import { WebhookEventType, createWebhookEventPayload } from './webhook-event';
import type { WebhookEventPayload } from './webhook-event';
import { WebhookOutboxNotFoundException } from './errors/webhook-outbox-not-found.exception';
import { WebhookOutboxPersistenceError } from './errors/webhook-outbox-persistence.error';
import { WebhookOutboxQueueWakeUpError } from './errors/webhook-outbox-queue-wake-up.error';
import { WebhookOutboxStatus } from './entity/webhook-outbox.entity';
import { WebhookRepository } from './webhook.repository';
import { WebhookQueueService } from './webhook-queue.service';

export type WebhookCallbackResult = Readonly<{
  onboardingId: string;
  submittedData: unknown;
  providerIdentity: string;
  resolvedConnector: Readonly<{
    connectorOrder: number;
    result: ConnectorExecutionResult;
  }>;
}>;

type WebhookLifecycleOnboarding = Pick<
  OnboardingEntity,
  'id' | 'workflowId' | 'workflowVersion' | 'status' | 'currentStep' | 'completedAt'
> &
  Partial<Pick<OnboardingEntity, 'getLifecycleTakenTransition' | 'getPreMutationWebhookSnapshot'>>;

type WebhookPolicyProvider = Pick<
  Workflow,
  'getRootNotifyWebhook' | 'getEffectiveNotifyWebhookForTransition'
>;

interface WebhookCommittedOnboardingContext {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: OnboardingEntity['status'];
  currentStep: string | null;
  completedAt: Date | null;
}

type OutboundAuditInput = {
  action: 'webhook.outbound_intent_created';
  resourceType: 'client_webhook_outbox';
  resourceId: string;
  metadata: Record<string, unknown>;
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly clientWebhookUrlResolver: ClientWebhookUrlResolver,
    private readonly dataSource: DataSource,
    private readonly webhookQueueService: WebhookQueueService,
    @Optional()
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort: ConnectorExecutionPort | undefined = undefined,
    private readonly auditService?: AuditService,
  ) {}

  async process(
    manager: EntityManager,
    input: Readonly<{
      providerKey: string;
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
    }>,
  ): Promise<WebhookCallbackResult> {
    const adapter = this.findAdapter(input.providerKey);
    const providerIdentity = adapter.type;
    const normalizedHeaders = this.normalizeHeaders(input.headers);

    try {
      const mappedResult = await adapter.mapCallbackResult({
        rawBody: input.rawBody,
        headers: normalizedHeaders,
      });

      return {
        onboardingId: mappedResult.onboardingId,
        submittedData: mappedResult.submittedData,
        providerIdentity,
        resolvedConnector: {
          connectorOrder: mappedResult.resolvedConnector.connectorOrder,
          result: mappedResult.result,
        },
      };
    } catch (error) {
      await this.recordInboundMappingFailed(manager, providerIdentity);
      throw error;
    }
  }

  private assertValidProviderKey(providerKey: string): void {
    if (!/^[a-z0-9_]+$/.test(providerKey)) {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
        message: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      });
    }
  }

  private findAdapter(
    providerKey: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter {
    this.assertValidProviderKey(providerKey);

    if (!this.connectorExecutionPort?.findAdapterByType) {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
        message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      });
    }

    try {
      return this.connectorExecutionPort.findAdapterByType(providerKey);
    } catch {
      throw new BadRequestException({
        code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
        message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      });
    }
  }

  private normalizeHeaders(
    headers: Readonly<Record<string, string | undefined>>,
  ): Record<string, string | undefined> {
    const normalized: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(headers)) {
      normalized[key.toLowerCase()] = value;
    }

    return normalized;
  }

  private async recordInboundMappingFailed(
    manager: EntityManager,
    providerIdentity: string,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(manager, {
        action: 'webhook.inbound_callback_mapping_failed',
        resourceType: 'provider_callback',
        resourceId: providerIdentity,
        metadata: { reason: 'mapping_failed' },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record inbound callback mapping audit event for ${providerIdentity}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private resolveEndpointUrl(
    webhook: { path: string },
    onboardingId: string,
    payload: WebhookEventPayload,
  ): string {
    try {
      return this.clientWebhookUrlResolver.resolve(webhook.path);
    } catch (error) {
      void this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_endpoint_resolution_failed',
        resourceType: 'onboarding',
        resourceId: onboardingId,
        metadata: {
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          reason: 'endpoint_resolution_failed',
          payload,
        },
      });
      throw error;
    }
  }

  async notifyError(
    _error: unknown,
    onboarding: WebhookLifecycleOnboarding,
    workflow: WebhookPolicyProvider,
  ): Promise<void> {
    const notifyWebhook = workflow.getRootNotifyWebhook();
    if (!notifyWebhook) {
      this.logger.debug(
        `CLIENT_WEBHOOK_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} operation=notify_error reason=no_configured_webhook`,
      );
      return;
    }

    const snapshot = onboarding.getPreMutationWebhookSnapshot?.() ?? {
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      completedAt: onboarding.completedAt,
    };
    try {
      await this.enqueueOutbox(
        {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: snapshot.status,
          currentStep: snapshot.currentStep,
          completedAt: snapshot.completedAt,
        },
        notifyWebhook,
      );
    } catch (error) {
      this.logNotifyFailure(error, onboarding);
    }
  }

  async notify(
    onboarding: WebhookLifecycleOnboarding,
    workflow: WebhookPolicyProvider,
  ): Promise<void> {
    const takenTransition = onboarding.getLifecycleTakenTransition?.();
    const notifyWebhook = takenTransition
      ? workflow.getEffectiveNotifyWebhookForTransition(takenTransition)
      : workflow.getRootNotifyWebhook();

    if (!notifyWebhook) {
      this.logger.debug(
        `CLIENT_WEBHOOK_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} operation=notify reason=no_configured_webhook`,
      );
      return;
    }
    try {
      await this.enqueueOutbox(
        {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          completedAt: onboarding.completedAt,
        },
        notifyWebhook,
      );
    } catch (error) {
      this.logNotifyFailure(error, onboarding);
    }
  }

  async resend(outboxId: string): Promise<void> {
    const outboxEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

    await this.auditService.logWebhook(this.dataSource.manager, {
      action: 'webhook.outbound_resend_requested',
      resourceType: 'client_webhook_outbox',
      resourceId: outboxId,
      metadata: {
        operation: 'resend',
        payload: outboxEntry?.payload ?? null,
      },
    });

    if (!outboxEntry) {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_resend_not_found',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: { outcome: 'not_found', payload: null },
      });
      throw new WebhookOutboxNotFoundException();
    }

    if (outboxEntry.status === WebhookOutboxStatus.DELIVERED) {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_resend_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          outcome: 'already_delivered',
          payload: outboxEntry.payload,
        },
      });
      return;
    }

    if (outboxEntry.status === WebhookOutboxStatus.SENDING) {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_resend_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          outcome: 'already_sending',
          payload: outboxEntry.payload,
        },
      });
      return;
    }

    await this.webhookQueueService.enqueue(outboxId);
  }

  private async enqueueOutbox(
    onboarding: WebhookCommittedOnboardingContext,
    notifyWebhook: { path: string },
  ): Promise<void> {
    const payload = createWebhookEventPayload({
      eventId: generateUuidV7(),
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      occurredAt: new Date(),
      onboarding: {
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        completedAt: onboarding.completedAt,
      },
    });
    let createdEntryId: string | undefined;

    try {
      const endpointUrl = this.resolveEndpointUrl(notifyWebhook, onboarding.id, payload);
      const createdEntry = await this.dataSource.transaction(async (manager) => {
        const entry = await this.webhookRepository.createPending(manager, {
          onboardingId: onboarding.id,
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          endpointUrl,
          payload,
        });

        await this.recordTransactionalOutboundAudit(manager, {
          action: 'webhook.outbound_intent_created',
          resourceType: 'client_webhook_outbox',
          resourceId: entry.id,
          metadata: {
            onboardingId: onboarding.id,
            eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
            status: 'pending',
            attempt: 0,
            payload: entry.payload,
          },
        });

        return entry;
      });
      createdEntryId = createdEntry.id;
      try {
        await this.webhookQueueService.enqueue(createdEntry.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw new WebhookOutboxQueueWakeUpError(createdEntry.id, reason, { cause: error });
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      const outboxPart = createdEntryId ? ` outboxId=${createdEntryId}` : '';
      if (error instanceof WebhookOutboxPersistenceError) {
        this.logger.error(
          `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id}${outboxPart} reason=${reason}`,
        );
      } else if (error instanceof WebhookOutboxQueueWakeUpError) {
        this.logger.warn(
          `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${error.outboxId} reason=${reason}`,
        );
      } else {
        this.logger.error(
          `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id}${outboxPart} reason=${reason}`,
        );
      }
    }
  }

  private logNotifyFailure(error: unknown, onboarding: WebhookLifecycleOnboarding): void {
    if (error instanceof WebhookOutboxPersistenceError) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id} reason=${reason}`,
      );
      return;
    }

    if (error instanceof WebhookOutboxQueueWakeUpError) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${error.outboxId} reason=${reason}`,
      );
      return;
    }

    const reason = error instanceof Error ? error.message : 'unknown error';
    this.logger.error(
      `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id} reason=${reason}`,
    );
  }

  private async recordTransactionalOutboundAudit(
    manager: EntityManager,
    input: OutboundAuditInput,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    await this.auditService.logWebhook(manager, input);
  }
}
