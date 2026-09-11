import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AppConfig } from '../config/app.config';
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
import { CallbackSignatureVerifier } from './callback-signature/callback-signature.verifier';
import { WebhookEventType, createWebhookEventPayload } from './webhook-event';
import type { WebhookEventPayload } from './webhook-event';
import { AsyncCallbackAuthenticationFailedException } from './errors/async-callback-authentication-failed.exception';
import { AsyncCallbackProviderKeyInvalidException } from './errors/async-callback-provider-key-invalid.exception';
import { WebhookDeliveryFailedException } from './errors/webhook-delivery-failed.exception';
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
  action:
    | 'webhook.outbound_endpoint_resolution_failed'
    | 'webhook.outbound_intent_created'
    | 'webhook.outbound_delivery_attempted'
    | 'webhook.outbound_delivery_succeeded'
    | 'webhook.outbound_delivery_failed'
    | 'webhook.outbound_resend_requested'
    | 'webhook.outbound_resend_not_found'
    | 'webhook.outbound_resend_noop';
  resourceType: 'onboarding' | 'client_webhook_outbox';
  resourceId: string;
  metadata: Record<string, unknown>;
};

type DeliveryOrigin = 'notify' | 'resend';

type DeliveryContext = {
  origin: DeliveryOrigin;
  resendPayload: WebhookEventPayload | null;
};

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly clientWebhookUrlResolver: ClientWebhookUrlResolver,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly webhookQueueService: WebhookQueueService,
    private readonly callbackSignatureVerifier: CallbackSignatureVerifier,
    @Optional()
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort: ConnectorExecutionPort | undefined = undefined,
    private readonly auditService?: AuditService,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  async process(
    manager: EntityManager,
    input: Readonly<{
      providerKey: string;
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
    }>,
  ): Promise<WebhookCallbackResult> {
    const adapter = this.findAdapter(input.providerKey);
    const providerIdentity = adapter.id;
    const normalizedHeaders = this.normalizeHeaders(input.headers);

    // Authenticate the raw bytes before parsing, correlating, or writing anything.
    const signatureOutcome = await this.callbackSignatureVerifier.verify(adapter, {
      rawBody: input.rawBody,
      headers: normalizedHeaders,
    });
    this.logger.debug(
      `ASYNC_CALLBACK_SIGNATURE_OUTCOME providerIdentity=${providerIdentity} outcome=${signatureOutcome}`,
    );
    if (signatureOutcome === 'skipped_unsigned_connector') {
      await this.recordInboundSignatureSkipped(manager, providerIdentity);
    }

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
      throw new AsyncCallbackProviderKeyInvalidException();
    }
  }

  private findAdapter(
    providerKey: string,
  ): Required<Pick<ConnectorAdapter, 'type' | 'mapCallbackResult'>> & ConnectorAdapter {
    this.assertValidProviderKey(providerKey);

    if (!this.connectorExecutionPort?.findAdapterById) {
      throw new AsyncCallbackAuthenticationFailedException();
    }

    try {
      return this.connectorExecutionPort.findAdapterById(providerKey);
    } catch {
      throw new AsyncCallbackAuthenticationFailedException();
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

  private async recordInboundSignatureSkipped(
    manager: EntityManager,
    providerIdentity: string,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(manager, {
        action: 'webhook.inbound_signature_skipped',
        resourceType: 'provider_callback',
        resourceId: providerIdentity,
        metadata: { outcome: 'skipped_unsigned_connector' },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record inbound signature skipped audit event for ${providerIdentity}`,
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
      void this.auditService
        .logWebhook(this.dataSource.manager, {
          action: 'webhook.outbound_endpoint_resolution_failed',
          resourceType: 'onboarding',
          resourceId: onboardingId,
          metadata: {
            eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
            reason: 'endpoint_resolution_failed',
            payload,
          },
        })
        .catch((auditError) => {
          this.logger.warn(
            `Unable to record webhook endpoint resolution audit event for ${onboardingId}`,
            auditError instanceof Error ? auditError.stack : undefined,
          );
        });
      throw error;
    }
  }

  private async recordNotificationSuppressed(
    onboardingId: string,
    operation: 'notify' | 'notify_error',
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_notification_suppressed',
        resourceType: 'onboarding',
        resourceId: onboardingId,
        metadata: {
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          operation,
          reason: 'no_configured_webhook',
        },
      });
    } catch (auditError) {
      this.logger.warn(
        `Unable to record webhook suppression audit event for ${onboardingId}`,
        auditError instanceof Error ? auditError.stack : undefined,
      );
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
      await this.recordNotificationSuppressed(onboarding.id, 'notify_error');
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
      await this.logNotifyFailure(error, onboarding);
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
      await this.recordNotificationSuppressed(onboarding.id, 'notify');
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
      await this.logNotifyFailure(error, onboarding);
    }
  }

  private async deliver(
    outboxId: string,
    context: DeliveryContext = { origin: 'notify', resendPayload: null },
  ): Promise<void> {
    const claimedEntry = await this.dataSource.transaction(async (manager) => {
      const pendingEntry = await this.webhookRepository.claimPendingForDelivery(manager, outboxId);

      if (!pendingEntry) {
        return null;
      }

      await this.recordTransactionalOutboundAudit(manager, {
        action: 'webhook.outbound_delivery_attempted',
        resourceType: 'client_webhook_outbox',
        resourceId: pendingEntry.id,
        metadata: {
          onboardingId: pendingEntry.onboardingId,
          eventType: pendingEntry.eventType,
          attempt: pendingEntry.attempts,
          payload: pendingEntry.payload,
        },
      });

      return pendingEntry;
    });

    if (!claimedEntry) {
      if (context.origin === 'resend') {
        await this.auditService.logWebhook(this.dataSource.manager, {
          action: 'webhook.outbound_resend_noop',
          resourceType: 'client_webhook_outbox',
          resourceId: outboxId,
          metadata: {
            outcome: 'claim_lost',
            payload: context.resendPayload,
          },
        });
      }
      return;
    }

    try {
      await this.deliverHttp(claimedEntry.endpointUrl, claimedEntry.payload);
    } catch {
      const restored = await this.restorePending(claimedEntry.id, {
        onboardingId: claimedEntry.onboardingId,
        eventType: claimedEntry.eventType,
        attempt: claimedEntry.attempts,
        payload: claimedEntry.payload,
      });
      if (restored) {
        throw new WebhookDeliveryFailedException();
      }
      throw new Error('CLIENT_WEBHOOK_OUTBOX_PENDING_RESTORE_FAILED');
    }

    await this.markDelivered(claimedEntry.id, {
      onboardingId: claimedEntry.onboardingId,
      eventType: claimedEntry.eventType,
      attempt: claimedEntry.attempts,
      payload: claimedEntry.payload,
    });
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

  private async deliverHttp(endpointUrl: string, payload: WebhookEventPayload): Promise<void> {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new WebhookDeliveryFailedException();
    }
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
        await this.recordOutboundIntentFailed(
          onboarding.id,
          'outbox_persistence_failed',
          createdEntryId,
          error,
        );
      } else if (error instanceof WebhookOutboxQueueWakeUpError) {
        this.logger.warn(
          `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${error.outboxId} reason=${reason}`,
        );
        await this.recordOutboundIntentFailed(
          onboarding.id,
          'outbox_enqueue_failed',
          error.outboxId,
          error,
        );
      } else {
        this.logger.error(
          `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id}${outboxPart} reason=${reason}`,
        );
        await this.recordOutboundIntentFailed(
          onboarding.id,
          'intent_failed',
          createdEntryId,
          error,
        );
      }
    }
  }

  private async logNotifyFailure(
    error: unknown,
    onboarding: WebhookLifecycleOnboarding,
  ): Promise<void> {
    if (error instanceof WebhookOutboxPersistenceError) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id} reason=${reason}`,
      );
      await this.recordOutboundIntentFailed(
        onboarding.id,
        'outbox_persistence_failed',
        undefined,
        error,
      );
      return;
    }

    if (error instanceof WebhookOutboxQueueWakeUpError) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${error.outboxId} reason=${reason}`,
      );
      await this.recordOutboundIntentFailed(
        onboarding.id,
        'outbox_enqueue_failed',
        error.outboxId,
        error,
      );
      return;
    }

    const reason = error instanceof Error ? error.message : 'unknown error';
    this.logger.error(
      `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id} reason=${reason}`,
    );
    await this.recordOutboundNotificationDropped(onboarding.id, error);
  }

  private async recordOutboundIntentFailed(
    onboardingId: string,
    reason: 'outbox_persistence_failed' | 'outbox_enqueue_failed' | 'intent_failed',
    outboxId: string | undefined,
    error: unknown,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_intent_failed',
        resourceType: 'onboarding',
        resourceId: onboardingId,
        metadata: {
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          reason,
          errorName: error instanceof Error ? error.name : 'UnknownError',
          outboxId: outboxId ?? null,
        },
      });
    } catch (auditError) {
      this.logger.warn(
        `Unable to record webhook intent failure audit event for ${onboardingId}`,
        auditError instanceof Error ? auditError.stack : undefined,
      );
    }
  }

  private async recordOutboundNotificationDropped(
    onboardingId: string,
    error: unknown,
  ): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_notification_dropped',
        resourceType: 'onboarding',
        resourceId: onboardingId,
        metadata: {
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          reason: 'notify_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (auditError) {
      this.logger.warn(
        `Unable to record webhook notification drop audit event for ${onboardingId}`,
        auditError instanceof Error ? auditError.stack : undefined,
      );
    }
  }

  private async markDelivered(
    outboxId: string,
    context: {
      onboardingId: string;
      eventType: WebhookEventType;
      attempt: number;
      payload: WebhookEventPayload;
    },
  ): Promise<void> {
    const deliveryUpdated = await this.dataSource.transaction(async (manager) => {
      const updated = await this.webhookRepository.markDeliveredFromSending(
        manager,
        outboxId,
        new Date(),
      );

      if (!updated) {
        return false;
      }

      await this.recordTransactionalOutboundAudit(manager, {
        action: 'webhook.outbound_delivery_succeeded',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          onboardingId: context.onboardingId,
          eventType: context.eventType,
          attempt: context.attempt,
          status: 'delivered',
          payload: context.payload,
        },
      });

      return true;
    });

    if (!deliveryUpdated) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }

  private async restorePending(
    outboxId: string,
    context: {
      onboardingId: string;
      eventType: WebhookEventType;
      attempt: number;
      payload: WebhookEventPayload;
    },
  ): Promise<boolean> {
    const restored = await this.dataSource.transaction(async (manager) => {
      const updated = await this.webhookRepository.finalizeFailedClaimFromSending(
        manager,
        outboxId,
      );

      if (!updated) {
        return false;
      }

      await this.recordTransactionalOutboundAudit(manager, {
        action: 'webhook.outbound_delivery_failed',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          onboardingId: context.onboardingId,
          eventType: context.eventType,
          attempt: context.attempt,
          status: 'pending',
          reason: 'delivery_failed',
          payload: context.payload,
        },
      });

      return true;
    });

    return restored;
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
