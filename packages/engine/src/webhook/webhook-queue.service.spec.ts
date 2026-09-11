import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { AppConfig, AppMode } from '../config/app.config';
import { WebhookQueueService } from './webhook-queue.service';

const queueInstances: Array<{
  name: string;
  add: jest.Mock;
  close: jest.Mock;
}> = [];
const workerInstances: Array<{
  name: string;
  processor: (job: { data: { outboxId: string } }) => Promise<void>;
  close: jest.Mock;
}> = [];
const redisInstances: Array<{ quit: jest.Mock }> = [];
const mockQueueAdd = jest.fn();
const mockQueueClose = jest.fn();
const mockWorkerClose = jest.fn();

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation((name: string) => {
      const instance = {
        name,
        add: mockQueueAdd,
        close: mockQueueClose,
      };
      queueInstances.push(instance);
      return instance;
    }),
    Worker: jest.fn().mockImplementation((name: string, processor: unknown) => {
      const instance = {
        name,
        processor: processor as (job: { data: { outboxId: string } }) => Promise<void>,
        close: mockWorkerClose,
      };
      workerInstances.push(instance);
      return instance;
    }),
  };
});

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => {
    const instance = {
      quit: jest.fn(),
    };
    redisInstances.push(instance);
    return instance;
  });
});

describe('WebhookQueueService', () => {
  let service: WebhookQueueService;
  let configService: ConfigService<AppConfig, true>;
  let deliveryService: { deliverDue: jest.Mock };
  let dataSource: DataSource;
  let auditService: { logWebhook: jest.Mock };
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    queueInstances.length = 0;
    workerInstances.length = 0;
    redisInstances.length = 0;

    mockQueueAdd.mockResolvedValue({});
    mockQueueClose.mockResolvedValue(undefined);
    mockWorkerClose.mockResolvedValue(undefined);

    deliveryService = {
      deliverDue: jest.fn().mockResolvedValue(undefined),
    };

    configService = {
      getOrThrow: jest.fn((key: string) => {
        switch (key) {
          case 'MODE':
            return AppMode.ALL;
          case 'REDIS_URL':
            return 'redis://localhost:6379';
          case 'WEBHOOK_OUTBOX_QUEUE_NAME':
            return 'test-webhook-queue';
          case 'WEBHOOK_OUTBOX_QUEUE_CONCURRENCY':
            return 2;
          default:
            throw new Error(`Unexpected key ${key}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    dataSource = { manager: {} } as unknown as DataSource;
    auditService = { logWebhook: jest.fn().mockResolvedValue(undefined) };

    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => Logger.prototype);

    service = new WebhookQueueService(
      configService,
      deliveryService as never,
      dataSource,
      auditService as unknown as AuditService,
    );
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  it('starts the worker consumer in worker-capable modes and skips api-only', async () => {
    await service.onModuleInit();

    expect(workerInstances).toHaveLength(1);
    expect(queueInstances).toHaveLength(1);
    expect(redisInstances).toHaveLength(1);

    const apiOnlyService = new WebhookQueueService(
      {
        getOrThrow: jest.fn((key: string) => {
          if (key === 'MODE') {
            return AppMode.API_ONLY;
          }

          return 'redis://localhost:6379';
        }),
      } as unknown as ConfigService<AppConfig, true>,
      deliveryService as never,
      dataSource,
    );

    await apiOnlyService.onModuleInit();

    expect(workerInstances).toHaveLength(1);
    expect(queueInstances).toHaveLength(1);
  });

  it('enqueues only outbox id with one attempt and bounded cleanup options', async () => {
    await service.enqueue('outbox-1');

    expect(mockQueueAdd).toHaveBeenCalledWith(
      'wake-up',
      { outboxId: 'outbox-1' },
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      }),
    );
  });

  it('enqueues a fresh wake-up even when an earlier failed/completed job for the same outbox id may be retained', async () => {
    await service.enqueue('outbox-1');
    await service.enqueue('outbox-1');

    expect(mockQueueAdd).toHaveBeenCalledTimes(2);
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      1,
      'wake-up',
      { outboxId: 'outbox-1' },
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      }),
    );
    expect(mockQueueAdd).toHaveBeenNthCalledWith(
      2,
      'wake-up',
      { outboxId: 'outbox-1' },
      expect.objectContaining({
        attempts: 1,
        removeOnComplete: { age: 60, count: 1000 },
        removeOnFail: { age: 60, count: 1000 },
      }),
    );
  });

  it('dispatches jobs to the due-only delivery entry point and logs metadata-only failures', async () => {
    const outboxId = 'outbox-2';
    await service.onModuleInit();

    deliveryService.deliverDue.mockRejectedValueOnce(new Error('boom'));

    const worker = workerInstances[0];
    await expect(worker.processor({ data: { outboxId } })).rejects.toThrow('boom');

    expect(deliveryService.deliverDue).toHaveBeenCalledWith(outboxId);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(loggerErrorSpy.mock.calls[0][0]).toContain(`outboxId=${outboxId}`);
    expect(loggerErrorSpy.mock.calls[0][0]).not.toContain('payload');
  });

  it('writes a webhook.outbound_queue_job_failed row and still rethrows the job error', async () => {
    const outboxId = 'outbox-3';
    await service.onModuleInit();

    deliveryService.deliverDue.mockRejectedValueOnce(new Error('boom'));

    const worker = workerInstances[0];
    await expect(worker.processor({ data: { outboxId } })).rejects.toThrow('boom');

    expect(auditService.logWebhook).toHaveBeenCalledWith(dataSource.manager, {
      action: 'webhook.outbound_queue_job_failed',
      resourceType: 'client_webhook_outbox',
      resourceId: outboxId,
      metadata: {
        errorName: 'Error',
      },
    });
  });

  it('still rethrows the job error when the audit write itself is rejected', async () => {
    const outboxId = 'outbox-4';
    await service.onModuleInit();

    deliveryService.deliverDue.mockRejectedValueOnce(new Error('boom'));
    auditService.logWebhook.mockRejectedValueOnce(new Error('audit unavailable'));

    const worker = workerInstances[0];
    await expect(worker.processor({ data: { outboxId } })).rejects.toThrow('boom');

    expect(auditService.logWebhook).toHaveBeenCalledTimes(1);
  });

  it('shuts down worker, queue, and redis in order from application shutdown hook', async () => {
    await service.onModuleInit();

    const shutdownOrder: string[] = [];
    mockWorkerClose.mockImplementation(async () => {
      shutdownOrder.push('worker');
    });
    mockQueueClose.mockImplementation(async () => {
      shutdownOrder.push('queue');
    });
    redisInstances[0].quit.mockImplementation(async () => {
      shutdownOrder.push('redis');
    });

    await service.onApplicationShutdown();

    expect(shutdownOrder).toEqual(['worker', 'queue', 'redis']);
  });

  it('shuts down idempotently when application shutdown hook is called more than once', async () => {
    await service.onModuleInit();

    await service.onApplicationShutdown();
    await service.onApplicationShutdown();

    expect(mockWorkerClose).toHaveBeenCalledTimes(1);
    expect(mockQueueClose).toHaveBeenCalledTimes(1);
    expect(redisInstances[0].quit).toHaveBeenCalledTimes(1);
  });
});
