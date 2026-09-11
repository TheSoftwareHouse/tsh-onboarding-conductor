import { Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AppConfig, AppMode } from '../config/app.config';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookRepository } from './webhook.repository';

const MAX_CONCURRENT_DELIVERIES = 5;
const UNRESOLVED_OUTBOX_POLL_RESOURCE_ID = 'unresolved';

@Injectable()
export class RetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RetryService.name);
  private timer: NodeJS.Timeout | null = null;
  private isRunning = false;
  private isShuttingDown = false;
  private activePollPromise: Promise<void> | null = null;

  constructor(
    private readonly webhookRepository: WebhookRepository,
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly webhookQueueService: WebhookQueueService,
    @Optional() private readonly auditService?: AuditService,
  ) {}

  onModuleInit(): void {
    const mode = this.configService.getOrThrow<AppMode>('MODE');

    if (mode === AppMode.API_ONLY) {
      return;
    }

    const pollIntervalMs = this.configService.getOrThrow<number>(
      'WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS',
    );

    void this.runPoll();
    this.timer = setInterval(() => void this.runPoll(), pollIntervalMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.isShuttingDown = true;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.activePollPromise;
  }

  private async runPoll(): Promise<void> {
    if (this.isRunning || this.isShuttingDown) {
      return;
    }

    this.isRunning = true;
    const activePollPromise = this.runPollCycle();
    this.activePollPromise = activePollPromise;

    await activePollPromise;

    if (this.activePollPromise === activePollPromise) {
      this.activePollPromise = null;
    }
  }

  private async runPollCycle(): Promise<void> {
    try {
      await this.expireStaleLeases();
      await this.dispatchDueWork();
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`CLIENT_WEBHOOK_OUTBOX_WORKER_POLL_FAILED reason=${reason}`);
      await this.recordPollFailed(error);
    } finally {
      this.isRunning = false;
    }
  }

  private async expireStaleLeases(): Promise<void> {
    const leaseMs = this.configService.getOrThrow<number>('WEBHOOK_OUTBOX_WORKER_LEASE_MS');
    const batchSize = this.configService.getOrThrow<number>('WEBHOOK_OUTBOX_WORKER_BATCH_SIZE');

    const expiredIds = await this.dataSource.transaction((manager) =>
      this.webhookRepository.expireStaleSendingLeases(manager, leaseMs, batchSize),
    );

    if (expiredIds.length > 0) {
      this.logger.warn(`CLIENT_WEBHOOK_OUTBOX_LEASES_EXPIRED count=${expiredIds.length}`);
      await this.runBoundedConcurrently(expiredIds, (outboxId) =>
        this.recordLeaseExpired(outboxId),
      );
    }
  }

  private async dispatchDueWork(): Promise<void> {
    const batchSize = this.configService.getOrThrow<number>('WEBHOOK_OUTBOX_WORKER_BATCH_SIZE');

    const candidateIds = await this.dataSource.transaction((manager) =>
      this.webhookRepository.findDuePendingIds(manager, batchSize),
    );

    if (candidateIds.length === 0) {
      return;
    }

    await this.runBoundedConcurrently(candidateIds, (outboxId) => this.enqueueDueWork(outboxId));
  }

  /**
   * Runs `worker` over `items` with at most `MAX_CONCURRENT_DELIVERIES` operations in flight at
   * once, so a large batch (a poll's due-work candidates, or a sweep's dead-lettered ids after a
   * worker outage) cannot fan out one connection-pool acquisition per id.
   */
  private async runBoundedConcurrently<T>(
    items: readonly T[],
    worker: (item: T) => Promise<void>,
  ): Promise<void> {
    const inFlight = new Set<Promise<void>>();

    for (const item of items) {
      const operation = worker(item);

      inFlight.add(operation);
      operation.then(() => inFlight.delete(operation));

      if (inFlight.size >= MAX_CONCURRENT_DELIVERIES) {
        await Promise.race(inFlight);
      }
    }

    await Promise.all(inFlight);
  }

  private async enqueueDueWork(outboxId: string): Promise<void> {
    try {
      await this.webhookQueueService.enqueue(outboxId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(
        `CLIENT_WEBHOOK_OUTBOX_WORKER_ENQUEUE_FAILED outboxId=${outboxId} reason=${reason}`,
      );
      await this.recordDispatchFailed(outboxId, error);
    }
  }

  /** Best effort only; a failed audit write must never abandon a sweep it was reporting on. */
  private async recordLeaseExpired(outboxId: string): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_lease_expired',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: { reason: 'lease_expired' },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record lease-expired audit event for ${outboxId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async recordPollFailed(error: unknown): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_poll_failed',
        resourceType: 'client_webhook_outbox',
        resourceId: UNRESOLVED_OUTBOX_POLL_RESOURCE_ID,
        metadata: {
          reason: 'poll_cycle_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (error) {
      this.logger.warn(
        'Unable to record poll-failed audit event',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async recordDispatchFailed(outboxId: string, error: unknown): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_dispatch_failed',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          reason: 'enqueue_failed',
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (error) {
      this.logger.warn(
        `Unable to record dispatch-failed audit event for ${outboxId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
