import { BadRequestException, Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
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
import { WebhookEventPayload, WebhookEventType, createWebhookEventPayload } from './webhook-event';
import { WebhookOutboxStatus } from './entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from './errors/webhook-delivery-failed.exception';
import { WebhookOutboxNotFoundException } from './errors/webhook-outbox-not-found.exception';
import { WebhookRepository } from './webhook.repository';

export type NormalizedAsyncCallback = Readonly<{
  onboardingId: string;
  submittedData: unknown;
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

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly clientWebhookUrlResolver: ClientWebhookUrlResolver,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    @Optional()
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort: ConnectorExecutionPort | undefined = undefined,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  async process(
    _manager: EntityManager,
    input: Readonly<{
      providerKey: string;
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
    }>,
  ): Promise<NormalizedAsyncCallback> {
    const adapter = this.findAdapter(input.providerKey);
    const normalizedHeaders = this.normalizeHeaders(input.headers);

    const mappedResult = await adapter.mapCallbackResult({
      rawBody: input.rawBody,
      headers: normalizedHeaders,
    });

    return {
      onboardingId: mappedResult.onboardingId,
      submittedData: mappedResult.submittedData,
      resolvedConnector: {
        connectorOrder: mappedResult.resolvedConnector.connectorOrder,
        result: mappedResult.result,
      },
    };
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

  private resolveEndpointUrl(webhook: { path: string }): string {
    return this.clientWebhookUrlResolver.resolve(webhook.path);
  }

  async notifyError(
    _error: unknown,
    onboarding: WebhookLifecycleOnboarding,
    workflow: WebhookPolicyProvider,
  ): Promise<void> {
    const notifyWebhook = workflow.getRootNotifyWebhook();
    if (!notifyWebhook) {
      return;
    }

    const snapshot = onboarding.getPreMutationWebhookSnapshot?.() ?? {
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      completedAt: onboarding.completedAt,
    };

    await this.notifyWithDeclaration(
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
      return;
    }

    await this.notifyWithDeclaration(
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
  }

  private async notifyWithDeclaration(
    onboarding: WebhookCommittedOnboardingContext,
    notifyWebhook: { path: string },
  ): Promise<void> {
    let createdEntryId: string | undefined;

    try {
      const endpointUrl = this.resolveEndpointUrl(notifyWebhook);
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

      const createdEntry = await this.dataSource.transaction((manager) =>
        this.webhookRepository.createPending(manager, {
          onboardingId: onboarding.id,
          eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
          endpointUrl,
          payload,
        }),
      );
      createdEntryId = createdEntry.id;

      await this.deliver(createdEntry.id);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      const outboxPart = createdEntryId ? ` outboxId=${createdEntryId}` : '';
      this.logger.error(
        `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id}${outboxPart} reason=${reason}`,
      );
    }
  }

  private async deliver(outboxId: string): Promise<void> {
    const claimedEntry = await this.dataSource.transaction((manager) =>
      this.webhookRepository.claimPendingForDelivery(manager, outboxId),
    );

    if (!claimedEntry) {
      return;
    }

    try {
      await this.deliverHttp(claimedEntry.endpointUrl, claimedEntry.payload);
    } catch {
      await this.restorePending(claimedEntry.id);
      throw new WebhookDeliveryFailedException();
    }

    await this.markDelivered(claimedEntry.id);
  }

  async resend(outboxId: string): Promise<void> {
    const outboxEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

    if (!outboxEntry) {
      throw new WebhookOutboxNotFoundException();
    }

    if (outboxEntry.status === WebhookOutboxStatus.DELIVERED) {
      return;
    }

    if (outboxEntry.status === WebhookOutboxStatus.SENDING) {
      return;
    }

    await this.deliver(outboxId);
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

  private async markDelivered(outboxId: string): Promise<void> {
    const deliveryUpdated = await this.dataSource.transaction((manager) =>
      this.webhookRepository.markDeliveredFromSending(manager, outboxId, new Date()),
    );

    if (!deliveryUpdated) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }

  private async restorePending(outboxId: string): Promise<void> {
    const restored = await this.dataSource.transaction((manager) =>
      this.webhookRepository.markPendingFromSending(manager, outboxId),
    );

    if (!restored) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_PENDING_RESTORE_FAILED');
    }
  }
}
