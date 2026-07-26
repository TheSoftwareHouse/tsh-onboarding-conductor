import { EntityManager } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookOutboxEntity, WebhookOutboxStatus } from './entity/webhook-outbox.entity';

export interface CreateWebhookOutboxInput {
  onboardingId: string;
  eventType: WebhookEventType;
  endpointUrl: string;
  payload: WebhookEventPayload;
}

export class WebhookRepository {
  async createPending(
    manager: EntityManager,
    input: CreateWebhookOutboxInput,
  ): Promise<WebhookOutboxEntity> {
    const repository = manager.getRepository(WebhookOutboxEntity);
    const outboxEntry = repository.create({
      id: generateUuidV7(),
      onboardingId: input.onboardingId,
      eventType: input.eventType,
      endpointUrl: input.endpointUrl,
      payload: input.payload,
      status: WebhookOutboxStatus.PENDING,
      attempts: 0,
      deliveredAt: null,
    });

    return repository.save(outboxEntry);
  }

  async findById(manager: EntityManager, id: string): Promise<WebhookOutboxEntity | null> {
    return manager.getRepository(WebhookOutboxEntity).findOne({ where: { id } });
  }

  async claimPendingForDelivery(
    manager: EntityManager,
    outboxId: string,
  ): Promise<WebhookOutboxEntity | null> {
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.SENDING,
        attempts: () => 'attempts + 1',
      })
      .where('id = :id', { id: outboxId })
      .andWhere('status = :status', { status: WebhookOutboxStatus.PENDING })
      .returning('*')
      .execute();

    return this.hydrateClaimedSnapshot(this.normalizeClaimedRaw(result.raw));
  }

  async markDeliveredFromSending(
    manager: EntityManager,
    id: string,
    deliveredAt: Date,
  ): Promise<boolean> {
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.DELIVERED,
        deliveredAt,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WebhookOutboxStatus.SENDING })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async markPendingFromSending(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.PENDING,
        deliveredAt: null,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WebhookOutboxStatus.SENDING })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private normalizeClaimedRaw(raw: unknown): Record<string, unknown> | undefined {
    if (!raw) {
      return undefined;
    }

    if (Array.isArray(raw)) {
      return raw[0] as Record<string, unknown> | undefined;
    }

    return raw as Record<string, unknown>;
  }

  private hydrateClaimedSnapshot(
    raw: Record<string, unknown> | undefined,
  ): WebhookOutboxEntity | null {
    if (!raw) {
      return null;
    }

    const entity = new WebhookOutboxEntity();

    if (raw.id !== undefined) {
      entity.id = raw.id as string;
    }
    if (raw.payload !== undefined) {
      entity.payload = raw.payload as WebhookEventPayload;
    }
    if (raw.status !== undefined) {
      entity.status = raw.status as WebhookOutboxStatus;
    }
    if (raw.attempts !== undefined) {
      entity.attempts = raw.attempts as number;
    }

    if (raw.onboarding_id !== undefined) {
      entity.onboardingId = raw.onboarding_id as string;
    }
    if (raw.event_type !== undefined) {
      entity.eventType = raw.event_type as WebhookOutboxEntity['eventType'];
    }
    if (raw.endpoint_url !== undefined) {
      entity.endpointUrl = raw.endpoint_url as string;
    }
    if (raw.created_at !== undefined) {
      entity.createdAt = raw.created_at as Date;
    }
    if (raw.updated_at !== undefined) {
      entity.updatedAt = raw.updated_at as Date;
    }
    if (raw.delivered_at !== undefined) {
      entity.deliveredAt = raw.delivered_at as Date | null;
    }

    return entity;
  }
}
