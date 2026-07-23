import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { ClientWebhookOutboxNotFoundException } from './errors/client-webhook-outbox-not-found.exception';
import { ClientWebhookDeliveryFailedException } from './errors/client-webhook-delivery-failed.exception';
import { ClientWebhookOutboxRepository } from './client-webhook-outbox.repository';
import { ClientWebhookOutboxStatus } from './entity/client-webhook-outbox.entity';

@Injectable()
export class ClientWebhookNotifyService {
  private readonly timeoutMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly outboxRepository: ClientWebhookOutboxRepository,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  async notify(outboxId: string): Promise<void> {
    const outboxEntry = await this.outboxRepository.findById(this.dataSource.manager, outboxId);

    if (!outboxEntry) {
      throw new ClientWebhookOutboxNotFoundException();
    }

    if (outboxEntry.status === ClientWebhookOutboxStatus.DELIVERED) {
      return;
    }

    const incremented = await this.outboxRepository.incrementAttemptsForPending(
      this.dataSource.manager,
      outboxId,
    );

    if (!incremented) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_ATTEMPT_INCREMENT_FAILED');
    }

    let response: Response;
    try {
      response = await fetch(outboxEntry.endpointUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(outboxEntry.payload),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      throw new ClientWebhookDeliveryFailedException();
    }

    if (!response.ok) {
      throw new ClientWebhookDeliveryFailedException();
    }

    const deliveryUpdated = await this.outboxRepository.markDelivered(
      this.dataSource.manager,
      outboxId,
      new Date(),
    );

    if (!deliveryUpdated) {
      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }
}
