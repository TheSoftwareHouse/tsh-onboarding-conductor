import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig, AppMode } from '../config/app.config';
import { RetryService } from './retry.service';
import { WebhookQueueService } from './webhook-queue.service';
import { WebhookRepository } from './webhook.repository';

describe('RetryService', () => {
  const manager = {} as EntityManager;

  const waitForImmediatePoll = async () => {
    for (let index = 0; index < 50; index += 1) {
      await Promise.resolve();
    }
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const createHarness = (mode: AppMode = AppMode.WORKER_ONLY) => {
    const dataSource = {
      transaction: jest.fn(async (callback: (manager: EntityManager) => unknown) =>
        callback(manager),
      ),
    } as unknown as DataSource;

    const webhookRepository = {
      expireStaleSendingLeases: jest.fn().mockResolvedValue(0),
      findDuePendingIds: jest.fn().mockResolvedValue([]),
    } as unknown as WebhookRepository;

    const webhookQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebhookQueueService;

    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: keyof AppConfig) => {
        switch (key) {
          case 'MODE':
            return mode;
          case 'WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS':
            return 1000;
          case 'WEBHOOK_OUTBOX_WORKER_BATCH_SIZE':
            return 25;
          case 'WEBHOOK_OUTBOX_WORKER_LEASE_MS':
            return 60000;
          default:
            throw new Error(`Unexpected config key: ${String(key)}`);
        }
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const worker = new RetryService(
      webhookRepository,
      dataSource,
      configService,
      webhookQueueService,
    );

    return {
      worker,
      webhookQueueService: webhookQueueService as unknown as {
        enqueue: jest.Mock;
      },
      webhookRepository: webhookRepository as unknown as {
        expireStaleSendingLeases: jest.Mock;
        findDuePendingIds: jest.Mock;
      },
      dataSource: dataSource as unknown as {
        transaction: jest.Mock;
      },
      configService: configService as unknown as {
        getOrThrow: jest.Mock;
      },
    };
  };

  it('starts an immediate poll and interval in all mode', async () => {
    const harness = createHarness(AppMode.ALL);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.configService.getOrThrow).toHaveBeenCalledWith('MODE');
    expect(harness.configService.getOrThrow).toHaveBeenCalledWith(
      'WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS',
    );
    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledWith(manager, 25);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('starts no timer in api-only mode', () => {
    const harness = createHarness(AppMode.API_ONLY);

    harness.worker.onModuleInit();

    expect(harness.configService.getOrThrow).toHaveBeenCalledWith('MODE');
    expect(harness.configService.getOrThrow).not.toHaveBeenCalledWith(
      'WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS',
    );
    expect(jest.getTimerCount()).toBe(0);
  });

  it('starts an immediate poll and interval in worker-only mode', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.configService.getOrThrow).toHaveBeenCalledWith('MODE');
    expect(harness.configService.getOrThrow).toHaveBeenCalledWith(
      'WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS',
    );
    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledWith(manager, 25);
    expect(jest.getTimerCount()).toBe(1);
  });

  it('clears its timer on module destroy', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(jest.getTimerCount()).toBe(1);

    await harness.worker.onModuleDestroy();

    expect(jest.getTimerCount()).toBe(0);
  });

  it('waits for the in-flight poll before completing module destroy', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    let resolvePoll: (() => void) | undefined;
    let destroyResolved = false;

    harness.webhookRepository.findDuePendingIds.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolvePoll = () => resolve([]);
        }),
    );

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    const destroyPromise = harness.worker.onModuleDestroy().then(() => {
      destroyResolved = true;
    });

    await waitForImmediatePoll();
    expect(destroyResolved).toBe(false);

    resolvePoll?.();
    await destroyPromise;

    expect(destroyResolved).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('does not start a new timer-triggered poll after shutdown begins', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    let resolvePoll: (() => void) | undefined;

    harness.webhookRepository.findDuePendingIds.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolvePoll = () => resolve([]);
        }),
    );

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    const destroyPromise = harness.worker.onModuleDestroy();

    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();

    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledTimes(1);

    resolvePoll?.();
    await destroyPromise;

    expect(jest.getTimerCount()).toBe(0);
    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledTimes(1);
  });

  it('expires stale leases before selecting due work', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);

    harness.webhookRepository.findDuePendingIds.mockResolvedValue(['id-1']);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.webhookRepository.expireStaleSendingLeases).toHaveBeenCalledWith(manager, 60000);
    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledWith(manager, 25);
  });

  it('logs the count of expired leases', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    const loggerErrorSpy = jest.spyOn(
      (harness.worker as unknown as { logger: { warn: jest.Mock } }).logger,
      'warn',
    );

    harness.webhookRepository.expireStaleSendingLeases.mockResolvedValue(3);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(loggerErrorSpy).toHaveBeenCalledWith('CLIENT_WEBHOOK_OUTBOX_LEASES_EXPIRED count=3');
  });

  it('enqueues each candidate for reconciliation', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    const candidateIds = ['id-1', 'id-2', 'id-3'];

    harness.webhookRepository.findDuePendingIds.mockResolvedValue(candidateIds);

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledTimes(3);
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith('id-1');
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith('id-2');
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith('id-3');
  });

  it('dispatches at most five enqueue operations concurrently', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    const candidateIds = Array.from({ length: 12 }, (_, index) => `id-${index + 1}`);
    const resolvers = new Map<string, () => void>();

    harness.webhookRepository.findDuePendingIds.mockResolvedValue(candidateIds);

    let inFlight = 0;
    let maxInFlight = 0;

    harness.webhookQueueService.enqueue.mockImplementation(async (outboxId: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise<void>((resolve) => {
        resolvers.set(outboxId, resolve);
      });
      inFlight -= 1;
    });

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(maxInFlight).toBe(5);
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledTimes(5);

    for (let index = 1; index <= 5; index += 1) {
      resolvers.get(`id-${index}`)?.();
    }
    await waitForImmediatePoll();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledTimes(10);

    for (let index = 6; index <= 10; index += 1) {
      resolvers.get(`id-${index}`)?.();
    }
    await waitForImmediatePoll();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledTimes(12);
    expect(maxInFlight).toBeLessThanOrEqual(5);
  });

  it('prevents overlapping polls', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    let resolveFirstPoll: (() => void) | undefined;

    harness.webhookRepository.findDuePendingIds.mockImplementation(
      () =>
        new Promise<string[]>((resolve) => {
          resolveFirstPoll = () => resolve([]);
        }),
    );

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();

    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledTimes(1);

    resolveFirstPoll?.();
    await waitForImmediatePoll();

    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();

    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalledTimes(2);
  });

  it('contains individual enqueue failures without aborting later candidates', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    const candidateIds = ['id-1', 'id-2', 'id-3'];
    const loggerErrorSpy = jest.spyOn(
      (harness.worker as unknown as { logger: { error: jest.Mock } }).logger,
      'error',
    );

    harness.webhookRepository.findDuePendingIds.mockResolvedValue(candidateIds);
    harness.webhookQueueService.enqueue.mockImplementation(async (outboxId: string) => {
      if (outboxId === 'id-2') {
        throw new Error('network timeout');
      }
    });

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledTimes(3);
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'CLIENT_WEBHOOK_OUTBOX_WORKER_ENQUEUE_FAILED outboxId=id-2 reason=network timeout',
    );
  });

  it('contains poll-level failures and does not leave the worker stuck', async () => {
    const harness = createHarness(AppMode.WORKER_ONLY);
    const loggerErrorSpy = jest.spyOn(
      (harness.worker as unknown as { logger: { error: jest.Mock } }).logger,
      'error',
    );

    harness.webhookRepository.expireStaleSendingLeases.mockRejectedValue(new Error('db down'));

    harness.worker.onModuleInit();
    await waitForImmediatePoll();

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'CLIENT_WEBHOOK_OUTBOX_WORKER_POLL_FAILED reason=db down',
    );

    harness.webhookRepository.expireStaleSendingLeases.mockResolvedValue(0);
    harness.webhookRepository.findDuePendingIds.mockResolvedValue([]);

    jest.advanceTimersByTime(1000);
    await waitForImmediatePoll();

    expect(harness.webhookRepository.findDuePendingIds).toHaveBeenCalled();
  });
});
