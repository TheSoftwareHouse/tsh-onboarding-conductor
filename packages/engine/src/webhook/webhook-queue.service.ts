import { Injectable, Logger, OnApplicationShutdown, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AppConfig, AppMode } from '../config/app.config';
import { HttpDeliveryService } from './delivery/http-delivery.service';

interface WebhookQueueJobData {
  outboxId: string;
}

const WEBHOOK_WAKE_UP_JOB_NAME = 'wake-up';

@Injectable()
export class WebhookQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(WebhookQueueService.name);
  private readonly queueName: string;
  private readonly concurrency: number;
  private readonly redisUrl: string;
  private connection: Redis | undefined;
  private queue: Queue<WebhookQueueJobData> | undefined;
  private worker: Worker<WebhookQueueJobData> | undefined;
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    private readonly configService: ConfigService<AppConfig, true>,
    private readonly httpDeliveryService: HttpDeliveryService,
    private readonly dataSource: DataSource,
    @Optional() private readonly auditService?: AuditService,
  ) {
    this.queueName = this.configService.getOrThrow<string>('WEBHOOK_OUTBOX_QUEUE_NAME');
    this.concurrency = this.configService.getOrThrow<number>('WEBHOOK_OUTBOX_QUEUE_CONCURRENCY');
    this.redisUrl = this.configService.getOrThrow<string>('REDIS_URL');
  }

  async onModuleInit(): Promise<void> {
    const mode = this.configService.getOrThrow<AppMode>('MODE');

    if (mode === AppMode.API_ONLY) {
      return;
    }

    await this.startConsumer();
  }

  onApplicationShutdown(): Promise<void> {
    if (this.shutdownPromise) {
      return this.shutdownPromise;
    }

    this.shutdownPromise = this.closeResources();
    return this.shutdownPromise;
  }

  private async closeResources(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = undefined;
    }

    if (this.queue) {
      await this.queue.close();
      this.queue = undefined;
    }

    if (this.connection) {
      await this.connection.quit();
      this.connection = undefined;
    }
  }

  async enqueue(outboxId: string): Promise<void> {
    const queue = await this.ensureQueue();

    await queue.add(
      WEBHOOK_WAKE_UP_JOB_NAME,
      { outboxId },
      {
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      },
    );
  }

  private async startConsumer(): Promise<void> {
    if (this.worker) {
      return;
    }

    const connection = await this.ensureConnection();
    this.queue = new Queue<WebhookQueueJobData>(this.queueName, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      },
    });

    this.worker = new Worker<WebhookQueueJobData>(
      this.queueName,
      async (job) => {
        await this.processJob(job.data.outboxId);
      },
      {
        connection,
        concurrency: this.concurrency,
      },
    );
  }

  private async ensureQueue(): Promise<Queue<WebhookQueueJobData>> {
    if (this.queue) {
      return this.queue;
    }

    const connection = await this.ensureConnection();
    this.queue = new Queue<WebhookQueueJobData>(this.queueName, {
      connection,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      },
    });

    return this.queue;
  }

  private async ensureConnection(): Promise<Redis> {
    if (this.connection) {
      return this.connection;
    }

    this.connection = new Redis(this.redisUrl, {
      maxRetriesPerRequest: null,
    });

    return this.connection;
  }

  private async processJob(outboxId: string): Promise<void> {
    try {
      await this.httpDeliveryService.deliverDue(outboxId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.error(`CLIENT_WEBHOOK_QUEUE_JOB_FAILED outboxId=${outboxId} reason=${reason}`);
      await this.recordJobFailureAudit(outboxId, error);
      throw error;
    }
  }

  private async recordJobFailureAudit(outboxId: string, error: unknown): Promise<void> {
    if (!this.auditService) {
      return;
    }

    try {
      await this.auditService.logWebhook(this.dataSource.manager, {
        action: 'webhook.outbound_queue_job_failed',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxId,
        metadata: {
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
      });
    } catch (auditError) {
      this.logger.error(
        `Failed to record webhook.outbound_queue_job_failed audit for outboxId=${outboxId}: ` +
          `${auditError instanceof Error ? auditError.message : String(auditError)}`,
      );
    }
  }
}
