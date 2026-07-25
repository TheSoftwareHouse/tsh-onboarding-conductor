import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NormalizedWorkflowWebhookDeclaration } from '@tsh/ddl-schema';
import { Workflow } from '../workflows/domain/workflow';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { generateUuidV7 } from '../utils/uuid.util';
import { WebhookEventPayload, WebhookEventType, createWebhookEventPayload } from './webhook-event';
import { WebhookOutboxStatus } from './entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from './errors/webhook-delivery-failed.exception';
import { WebhookOutboxNotFoundException } from './errors/webhook-outbox-not-found.exception';
import { WebhookRepository } from './webhook.repository';

@Injectable()
export class WebhookService {
  private readonly timeoutMs: number;

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly clientWebhookUrlResolver: ClientWebhookUrlResolver,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  private resolveEndpointUrl(webhook: NormalizedWorkflowWebhookDeclaration): string {
    return this.clientWebhookUrlResolver.resolve(webhook.path);
  }

  async notify(
    manager: EntityManager,
    workflow: Workflow,
    eventType: WebhookEventType,
    onboarding: OnboardingEntity,
  ): Promise<void> {
    const webhook = workflow.getSourceStepWebhook(onboarding.currentStep);

    if (!webhook) {
      return;
    }

    const endpointUrl = this.resolveEndpointUrl(webhook);
    const payload = createWebhookEventPayload({
      eventId: generateUuidV7(),
      eventType,
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

    const createdEntry = await this.webhookRepository.createSending(manager, {
      onboardingId: onboarding.id,
      eventType,
      endpointUrl,
      payload,
    });

    try {
      await this.deliverWithPersistence(
        manager,
        createdEntry.id,
        createdEntry.endpointUrl,
        createdEntry.payload,
      );
    } catch (error) {
      if (error instanceof WebhookDeliveryFailedException) {
        return;
      }

      throw error;
    }
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

    const claimedEntry = await this.webhookRepository.claimPendingForDelivery(
      this.dataSource.manager,
      outboxId,
    );

    if (!claimedEntry) {
      return;
    }

    await this.deliverWithPersistence(
      this.dataSource.manager,
      claimedEntry.id,
      claimedEntry.endpointUrl,
      claimedEntry.payload,
    );
  }

  private async deliverWithPersistence(
    manager: EntityManager,
    outboxId: string,
    endpointUrl: string,
    payload: WebhookEventPayload,
  ): Promise<void> {
    let response: Response;

    try {
      response = await fetch(endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      await this.restorePending(manager, outboxId);
      throw new WebhookDeliveryFailedException();
    }

    if (!response.ok) {
      await this.restorePending(manager, outboxId);
      throw new WebhookDeliveryFailedException();
    }

    const deliveryUpdated = await this.webhookRepository.markDeliveredFromSending(
      manager,
      outboxId,
      new Date(),
    );

    if (!deliveryUpdated) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }

  private async restorePending(manager: EntityManager, outboxId: string): Promise<void> {
    const restored = await this.webhookRepository.markPendingFromSending(manager, outboxId);

    if (!restored) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_PENDING_RESTORE_FAILED');
    }
  }
}
