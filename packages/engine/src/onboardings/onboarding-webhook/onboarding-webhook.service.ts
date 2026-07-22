import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkflowStatus } from '@tsh/ddl-schema';
import { EntityManager } from 'typeorm';
import {
  ClientWebhookEventType,
  createClientWebhookEventPayload,
} from '../../client-webhook-outbox/client-webhook-event';
import { ClientWebhookOutboxRepository } from '../../client-webhook-outbox/client-webhook-outbox.repository';
import { generateUuidV7 } from '../../utils/uuid.util';

export interface OnboardingWebhookSnapshot {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
  completedAt: Date | null;
}

@Injectable()
export class OnboardingWebhookService {
  private readonly clientWebhookUrl: string | undefined;

  constructor(
    configService: ConfigService,
    private readonly clientWebhookOutboxRepository: ClientWebhookOutboxRepository,
  ) {
    this.clientWebhookUrl = configService.get<string>('CLIENT_WEBHOOK_URL');
  }

  async createPendingEvent(
    manager: EntityManager,
    eventType: ClientWebhookEventType,
    onboardingSnapshot: OnboardingWebhookSnapshot,
  ): Promise<string | null> {
    if (!this.clientWebhookUrl) {
      return null;
    }

    const payload = createClientWebhookEventPayload({
      eventId: generateUuidV7(),
      eventType,
      occurredAt: new Date(),
      onboarding: onboardingSnapshot,
    });

    const createdEntry = await this.clientWebhookOutboxRepository.createPending(manager, {
      onboardingId: onboardingSnapshot.id,
      eventType,
      endpointUrl: this.clientWebhookUrl,
      payload,
    });

    return createdEntry.id;
  }
}
