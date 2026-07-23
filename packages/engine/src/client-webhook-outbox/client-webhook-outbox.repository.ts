import { EntityManager } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { ClientWebhookEventPayload, ClientWebhookEventType } from './client-webhook-event';
import {
  ClientWebhookOutboxEntity,
  ClientWebhookOutboxStatus,
} from './entity/client-webhook-outbox.entity';

export interface CreateClientWebhookOutboxInput {
  onboardingId: string;
  eventType: ClientWebhookEventType;
  endpointUrl: string;
  payload: ClientWebhookEventPayload;
}

export class ClientWebhookOutboxRepository {
  async createPending(
    manager: EntityManager,
    input: CreateClientWebhookOutboxInput,
  ): Promise<ClientWebhookOutboxEntity> {
    const repository = manager.getRepository(ClientWebhookOutboxEntity);
    const outboxEntry = repository.create({
      id: generateUuidV7(),
      onboardingId: input.onboardingId,
      eventType: input.eventType,
      endpointUrl: input.endpointUrl,
      payload: input.payload,
      status: ClientWebhookOutboxStatus.PENDING,
      attempts: 0,
      deliveredAt: null,
    });

    return repository.save(outboxEntry);
  }

  async findById(manager: EntityManager, id: string): Promise<ClientWebhookOutboxEntity | null> {
    return manager.getRepository(ClientWebhookOutboxEntity).findOne({ where: { id } });
  }

  async incrementAttemptsForPending(manager: EntityManager, id: string): Promise<boolean> {
    const result = await manager
      .getRepository(ClientWebhookOutboxEntity)
      .createQueryBuilder()
      .update(ClientWebhookOutboxEntity)
      .set({ attempts: () => 'attempts + 1' })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: ClientWebhookOutboxStatus.PENDING })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  async markDelivered(manager: EntityManager, id: string, deliveredAt: Date): Promise<boolean> {
    const result = await manager.getRepository(ClientWebhookOutboxEntity).update(
      { id },
      {
        status: ClientWebhookOutboxStatus.DELIVERED,
        deliveredAt,
      },
    );

    return (result.affected ?? 0) > 0;
  }
}
