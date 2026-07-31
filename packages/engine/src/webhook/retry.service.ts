import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfig, AppMode } from '../config/app.config';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookRepository } from './webhook.repository';

const MAX_CONCURRENT_DELIVERIES = 5;

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
    } finally {
      this.isRunning = false;
    }
  }

  private async expireStaleLeases(): Promise<void> {
    const leaseMs = this.configService.getOrThrow<number>('WEBHOOK_OUTBOX_WORKER_LEASE_MS');

    const expiredCount = await this.dataSource.transaction((manager) =>
      this.webhookRepository.expireStaleSendingLeases(manager, leaseMs),
    );

    if (expiredCount > 0) {
      this.logger.warn(`CLIENT_WEBHOOK_OUTBOX_LEASES_EXPIRED count=${expiredCount}`);
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

    const inFlight = new Set<Promise<void>>();

    for (const outboxId of candidateIds) {
      const enqueueOperation = this.enqueueDueWork(outboxId);

      inFlight.add(enqueueOperation);
      enqueueOperation.then(() => inFlight.delete(enqueueOperation));

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
    }
  }
}
