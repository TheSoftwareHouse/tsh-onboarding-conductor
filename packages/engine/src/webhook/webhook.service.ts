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
import { WebhookEventType, createWebhookEventPayload } from './webhook-event';
import { WebhookOutboxPersistenceError } from './errors/webhook-outbox-persistence.error';
import { WebhookOutboxQueueWakeUpError } from './errors/webhook-outbox-queue-wake-up.error';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookRepository } from './webhook.repository';

export type WebhookCallbackResult = Readonly<{
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

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly clientWebhookUrlResolver: ClientWebhookUrlResolver,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly webhookQueueService: WebhookQueueService,
    @Optional()
    @Inject(WORKFLOW_CONNECTOR_CALLBACK_EXECUTION_PORT)
    private readonly connectorExecutionPort: ConnectorExecutionPort | undefined = undefined,
  ) {}

  async process(
    _manager: EntityManager,
    input: Readonly<{
      providerKey: string;
      rawBody: Uint8Array;
      headers: Readonly<Record<string, string | undefined>>;
    }>,
  ): Promise<WebhookCallbackResult> {
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
        false,
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
        true,
      );
    } catch (error) {
      this.logNotifyFailure(error, onboarding);
    }
  }

  private async enqueueOutbox(
    onboarding: WebhookCommittedOnboardingContext,
    notifyWebhook: { path: string },
    useIndependentTransaction: boolean,
  ): Promise<void> {
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

    try {
      const createdEntry = useIndependentTransaction
        ? await this.dataSource.transaction((manager) =>
            this.webhookRepository.createPending(manager, {
              onboardingId: onboarding.id,
              eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
              endpointUrl,
              payload,
            }),
          )
        : await this.webhookRepository.createPending(this.dataSource.manager, {
            onboardingId: onboarding.id,
            eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
            endpointUrl,
            payload,
          });

      try {
        await this.webhookQueueService.enqueue(createdEntry.id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        throw new WebhookOutboxQueueWakeUpError(createdEntry.id, reason, { cause: error });
      }
    } catch (error) {
      if (error instanceof WebhookOutboxQueueWakeUpError) {
        throw error;
      }

      if (error instanceof WebhookOutboxPersistenceError) {
        throw error;
      }

      const reason = error instanceof Error ? error.message : 'unknown error';
      throw new WebhookOutboxPersistenceError(reason, { cause: error });
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
}
