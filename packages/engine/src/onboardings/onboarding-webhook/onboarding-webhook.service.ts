import { Injectable } from '@nestjs/common';
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
  constructor(private readonly clientWebhookOutboxRepository: ClientWebhookOutboxRepository) {}

  async createPendingEvent(
    manager: EntityManager,
    endpointUrl: string,
    eventType: ClientWebhookEventType,
    onboardingSnapshot: OnboardingWebhookSnapshot,
  ): Promise<string> {
    const payload = createClientWebhookEventPayload({
      eventId: generateUuidV7(),
      eventType,
      occurredAt: new Date(),
      onboarding: onboardingSnapshot,
    });

    const createdEntry = await this.clientWebhookOutboxRepository.createPending(manager, {
      onboardingId: onboardingSnapshot.id,
      eventType,
      endpointUrl,
      payload,
    });

    return createdEntry.id;
  }
}
