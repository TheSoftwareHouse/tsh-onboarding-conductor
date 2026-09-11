import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
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
    @Optional() private readonly auditService?: AuditService,
  ) {
    this.timeoutMs = this.configService.getOrThrow<number>('CLIENT_WEBHOOK_TIMEOUT_MS');
  }

  async deliverDue(outboxId: string): Promise<void> {
    const claimedEntry = await this.dataSource.transaction(async (manager) => {
      const entry = await this.webhookRepository.claimPendingForDelivery(manager, outboxId, {
        dueCheck: true,
      });

      if (entry) {
        await this.auditService?.logWebhook(manager, {
          action: 'webhook.outbound_delivery_attempted',
          resourceType: 'client_webhook_outbox',
          resourceId: entry.id,
          metadata: {
            onboardingId: entry.onboardingId,
            eventType: entry.eventType,
            attempt: entry.attempts,
            payload: entry.payload,
          },
        });
      }

      return entry;
    });

    if (!claimedEntry) {
      await this.auditFinalizationNoop(this.dataSource.manager, outboxId, {
        reason: 'claim_lost',
      });
      return;
    }

    try {
      await this.deliverHttp(claimedEntry.endpointUrl, claimedEntry.payload);
    } catch {
      const finalized = await this.finalizeFailedDelivery(claimedEntry.id, {
        onboardingId: claimedEntry.onboardingId,
        eventType: claimedEntry.eventType,
        attempt: claimedEntry.attempts,
        payload: claimedEntry.payload,
      });
      if (!finalized) {
        return;
      }
      throw new WebhookDeliveryFailedException();
    }

    await this.markDelivered(claimedEntry.id, {
      onboardingId: claimedEntry.onboardingId,
      eventType: claimedEntry.eventType,
      attempt: claimedEntry.attempts,
      payload: claimedEntry.payload,
    });
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

  private async markDelivered(
    outboxId: string,
    context: {
      onboardingId: string;
      eventType: string;
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
      if (updated) {
        await this.auditService?.logWebhook(manager, {
          action: 'webhook.outbound_delivery_succeeded',
          resourceType: 'client_webhook_outbox',
          resourceId: outboxId,
          metadata: {
            ...context,
            status: 'delivered',
          },
        });
      }
      return updated;
    });

    if (!deliveryUpdated) {
      const currentEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

      if (
        currentEntry?.status === WebhookOutboxStatus.ERROR ||
        currentEntry?.status === WebhookOutboxStatus.DELIVERED
      ) {
        this.logger.warn(
          `CLIENT_WEBHOOK_OUTBOX_DELIVERY_NOOP outboxId=${outboxId} reason=state_already_terminal`,
        );
        await this.auditFinalizationNoop(this.dataSource.manager, outboxId, {
          ...context,
          status: currentEntry.status.toLowerCase(),
          reason: 'state_already_terminal',
        });
        return;
      }

      await this.auditFinalizationNoop(this.dataSource.manager, outboxId, {
        ...context,
        status: currentEntry?.status?.toLowerCase(),
        reason: 'delivery_update_failed',
      });
      throw new Error('CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED');
    }
  }

  private async finalizeFailedDelivery(
    outboxId: string,
    context: {
      onboardingId: string;
      eventType: string;
      attempt: number;
      payload: WebhookEventPayload;
    },
  ): Promise<boolean> {
    const finalizedEntry = await this.dataSource.transaction(async (manager) => {
      const entry = await this.webhookRepository.finalizeFailedClaimFromSending(manager, outboxId);
      if (entry) {
        await this.auditService?.logWebhook(manager, {
          action: 'webhook.outbound_delivery_failed',
          resourceType: 'client_webhook_outbox',
          resourceId: outboxId,
          metadata: {
            ...context,
            status: entry.status.toLowerCase(),
            reason: 'delivery_failed',
          },
        });
      }
      return entry;
    });

    if (finalizedEntry) {
      return true;
    }

    const currentEntry = await this.webhookRepository.findById(this.dataSource.manager, outboxId);

    if (currentEntry?.status === WebhookOutboxStatus.ERROR) {
      this.logger.warn(
        `CLIENT_WEBHOOK_OUTBOX_FINALIZATION_NOOP outboxId=${outboxId} reason=lease_expired`,
      );
      await this.auditFinalizationNoop(this.dataSource.manager, outboxId, {
        ...context,
        status: currentEntry.status.toLowerCase(),
        reason: 'lease_expired',
      });
      return false;
    }

    await this.auditFinalizationNoop(this.dataSource.manager, outboxId, {
      ...context,
      status: currentEntry?.status?.toLowerCase(),
      reason: 'finalization_update_failed',
    });
    throw new Error('CLIENT_WEBHOOK_OUTBOX_FINALIZATION_UPDATE_FAILED');
  }

  /**
   * Best-effort record of a delivery outcome lost with no other evidence: a claim that vanished
   * before delivery was attempted, a finalization that lost the race to an expired lease, or a
   * delivery/finalization state update that could not be confirmed. A failed write here is logged
   * and swallowed — it must never change what the caller returns or throws.
   */
  private async auditFinalizationNoop(
    manager: EntityManager,
    outboxId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    try {
      await this.auditService?.logWebhook(manager, {
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata,
      });
    } catch (auditError) {
      this.logger.error(
        `Failed to record finalization no-op audit for outboxId=${outboxId}: ${
          auditError instanceof Error ? auditError.message : String(auditError)
        }`,
      );
    }
  }
}
