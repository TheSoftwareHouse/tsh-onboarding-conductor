import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../config/app.config';
import { WebhookOutboxStatus } from '../entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from '../errors/webhook-delivery-failed.exception';
import { WebhookEventPayload } from '../webhook-event';
import { WebhookRepository } from '../webhook.repository';

@Injectable()
export class HttpDeliveryService {
  private readonly logger = new Logger(HttpDeliveryService.name);
  private readonly timeoutMs: number;

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  async deliverDue(outboxId: string): Promise<void> {
    const claimedEntry = await this.dataSource.transaction((manager) =>
      this.webhookRepository.claimPendingForDelivery(manager, outboxId, { dueCheck: true }),
    );

    if (!claimedEntry) {
      return;
    }

    try {
      await this.deliverHttp(claimedEntry.endpointUrl, claimedEntry.payload);
    } catch {
      const finalized = await this.finalizeFailedDelivery(claimedEntry.id);
      if (!finalized) {
        return;
      }
      throw new WebhookDeliveryFailedException();
    }

    await this.markDelivered(claimedEntry.id);
  }

  private async deliverHttp(endpointUrl: string, payload: WebhookEventPayload): Promise<void> {
    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Event-Id': payload.event.id,
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
      const currentEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

      if (
        currentEntry?.status === WebhookOutboxStatus.ERROR ||
        currentEntry?.status === WebhookOutboxStatus.DELIVERED
      ) {
        this.logger.warn(
          `CLIENT_WEBHOOK_OUTBOX_DELIVERY_NOOP outboxId=${outboxId} reason=state_already_terminal`,
        );
        return;
      }

      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }

  private async finalizeFailedDelivery(outboxId: string): Promise<boolean> {
    const finalizedEntry = await this.dataSource.transaction((manager) =>
      this.webhookRepository.finalizeFailedClaimFromSending(manager, outboxId),
    );

    if (finalizedEntry) {
      return true;
    }

    const currentEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

    if (currentEntry?.status === WebhookOutboxStatus.ERROR) {
      this.logger.warn(
        `CLIENT_WEBHOOK_OUTBOX_FINALIZATION_NOOP outboxId=${outboxId} reason=lease_expired`,
      );
      return false;
    }

    throw new Error('CLIENT_WEBHOOK_OUTBOX_FINALIZATION_UPDATE_FAILED');
  }
}
