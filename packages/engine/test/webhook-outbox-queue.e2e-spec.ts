import { randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppMode } from '../src/config/app.config';
import { AuditService } from '../src/audit/audit.service';
import { HttpDeliveryService } from '../src/webhook/delivery/http-delivery.service';
import { WebhookOutboxStatus } from '../src/webhook/entity/webhook-outbox.entity';
import { RetryService } from '../src/webhook/retry.service';
import { WebhookQueueService } from '../src/webhook/webhook-queue.service';
import { WebhookService } from '../src/webhook/webhook.service';
import { WebhookEventPayload, WebhookEventType } from '../src/webhook/webhook-event';

jest.setTimeout(30000);

type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type OutboxRow = {
  id: string;
  onboarding_id: string;
  endpoint_url: string;
  payload: WebhookEventPayload;
  status: WebhookOutboxStatus;
  attempts: number;
  max_attempts: number;
  next_delivery_at: string | null;
  sending_started_at: string | null;
  delivered_at: string | null;
};

const redisUrl = 'redis://127.0.0.1:6379/0';
const queueName = `webhook-outbox-e2e-${process.pid}-${Date.now()}`;
const queuePrefix = 'bull';

const waitForCondition = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    if (await condition()) {
      return;
    }

    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  throw new Error('Timed out waiting for test condition');
};

describe('Webhook outbox queue integration', () => {
  let app: NestExpressApplication | null = null;
  let localServer: Server | null = null;
  let localServerUrl = '';
  let responseMode: 'success' | 'failure' = 'success';
  const capturedRequests: CapturedRequest[] = [];
  const createdOnboardingIds = new Set<string>();
  const createdOutboxIds = new Set<string>();

  const dataSource = (): DataSource => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app.get(DataSource);
  };

  const startLocalServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      localServer = createServer(async (request: IncomingMessage, response: ServerResponse) => {
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }

        const rawBody = Buffer.concat(chunks).toString('utf8');
        let body: unknown = rawBody;
        if (rawBody.length > 0) {
          try {
            body = JSON.parse(rawBody);
          } catch {
            body = rawBody;
          }
        }

        capturedRequests.push({
          method: request.method ?? '',
          path: new URL(request.url ?? '/', 'http://127.0.0.1').pathname,
          headers: request.headers,
          body,
        });

        if (responseMode === 'failure') {
          response.statusCode = 503;
          response.end('client webhook unavailable');
          return;
        }

        response.statusCode = 204;
        response.end();
      });

      localServer.once('error', reject);
      localServer.listen(0, '127.0.0.1', () => {
        const address = localServer?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve local webhook server address'));
          return;
        }

        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

  const closeLocalServer = async () => {
    if (!localServer?.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      localServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  const openApp = async (mode: AppMode): Promise<void> => {
    process.env.MODE = mode;

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    moduleFixture.get(ConfigService).set('MODE', mode);

    app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  };

  const closeApp = async () => {
    if (app) {
      await app.close();
      app = null;
    }
  };

  const createQueue = () => {
    const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const queue = new Queue<{ outboxId: string }>(queueName, {
      connection,
      prefix: queuePrefix,
    });

    return { connection, queue };
  };

  const addQueueJob = async (outboxId: string, jobId = outboxId) => {
    const { connection, queue } = createQueue();

    try {
      return await queue.add(
        'test-wake-up',
        { outboxId },
        {
          ...(jobId ? { jobId } : {}),
          attempts: 1,
          removeOnComplete: { age: 60, count: 1000 },
          removeOnFail: { age: 60, count: 1000 },
        },
      );
    } finally {
      await queue.close();
      await connection.quit();
    }
  };

  const readQueueJobState = async (jobId: string) => {
    const { connection, queue } = createQueue();

    try {
      const job = await queue.getJob(jobId);

      if (!job) {
        return null;
      }

      return job.getState();
    } finally {
      await queue.close();
      await connection.quit();
    }
  };

  const readQueueWakeUps = async (outboxId: string) => {
    const { connection, queue } = createQueue();

    try {
      const jobs = await queue.getJobs(
        ['wait', 'active', 'delayed', 'completed', 'failed', 'paused', 'prioritized'],
        0,
        200,
        true,
      );

      return jobs
        .filter((job) => job.data.outboxId === outboxId)
        .map((job) => ({ id: String(job.id) }));
    } finally {
      await queue.close();
      await connection.quit();
    }
  };

  const waitForJobFinished = async (jobId: string): Promise<void> => {
    await waitForCondition(async () => {
      const { connection, queue } = createQueue();

      try {
        const job = await queue.getJob(jobId);
        return Boolean(job?.finishedOn);
      } finally {
        await queue.close();
        await connection.quit();
      }
    });
  };

  const clearQueue = async () => {
    const { connection, queue } = createQueue();

    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
      await connection.quit();
    }
  };

  const createOnboardingFixture = async (params?: {
    id?: string;
    status?: string;
    currentStep?: string;
    context?: Record<string, unknown>;
  }): Promise<string> => {
    const id = params?.id ?? randomUUID();

    await dataSource().query(
      `INSERT INTO onboardings (
         id,
         workflow_id,
         workflow_version,
         status,
         current_step,
         context,
         expires_at,
         created_at,
         updated_at,
         completed_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, NOW(), NOW(), $8)`,
      [
        id,
        'base',
        1,
        params?.status ?? 'awaiting_user',
        params?.currentStep ?? 'collect_email',
        JSON.stringify(params?.context ?? {}),
        null,
        null,
      ],
    );
    createdOnboardingIds.add(id);
    return id;
  };

  const buildPayload = (onboardingId: string, eventId = randomUUID()): WebhookEventPayload => ({
    version: 1,
    event: {
      id: eventId,
      type: WebhookEventType.ONBOARDING_STATE_CHANGED,
      occurredAt: '2026-07-31T20:00:00.000Z',
    },
    onboarding: {
      id: onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
      completedAt: null,
    },
  });

  const createOutboxFixture = async (params: {
    onboardingId: string;
    payload?: WebhookEventPayload;
    status?: WebhookOutboxStatus;
    attempts?: number;
    nextDeliveryAt?: string | null;
    sendingStartedAt?: string | null;
    deliveredAt?: string | null;
    baseDelayMs?: number;
  }): Promise<string> => {
    const id = randomUUID();
    const status = params.status ?? WebhookOutboxStatus.PENDING;

    await dataSource().query(
      `INSERT INTO client_webhook_outbox (
         id,
         onboarding_id,
         event_type,
         endpoint_url,
         payload,
         status,
         attempts,
         max_attempts,
         base_delay_ms,
         backoff_multiplier,
         max_backoff_ms,
         next_delivery_at,
         sending_started_at,
         created_at,
         updated_at,
         delivered_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, NOW(), NOW(), $14)`,
      [
        id,
        params.onboardingId,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        `${localServerUrl}/webhook`,
        JSON.stringify(params.payload ?? buildPayload(params.onboardingId)),
        status,
        params.attempts ?? 0,
        5,
        params.baseDelayMs ?? 5000,
        2,
        300000,
        params.nextDeliveryAt ?? new Date(Date.now() - 1000).toISOString(),
        params.sendingStartedAt ??
          (status === WebhookOutboxStatus.SENDING
            ? new Date(Date.now() - 120000).toISOString()
            : null),
        params.deliveredAt ?? (status === WebhookOutboxStatus.DELIVERED ? new Date() : null),
      ],
    );
    createdOutboxIds.add(id);
    return id;
  };

  const readOutboxRow = async (id: string): Promise<OutboxRow> => {
    const rows = (await dataSource().query('SELECT * FROM client_webhook_outbox WHERE id = $1', [
      id,
    ])) as OutboxRow[];

    if (rows.length !== 1) {
      throw new Error(`Expected one outbox row for id ${id}`);
    }

    return rows[0];
  };

  const readOutboxRows = async (onboardingId: string): Promise<OutboxRow[]> =>
    (await dataSource().query(
      'SELECT * FROM client_webhook_outbox WHERE onboarding_id = $1 ORDER BY created_at, id',
      [onboardingId],
    )) as OutboxRow[];

  const expectNoRequestsFor = async (durationMs: number) => {
    const initialCount = capturedRequests.length;
    await new Promise<void>((resolve) => setTimeout(resolve, durationMs));
    expect(capturedRequests).toHaveLength(initialCount);
  };

  beforeAll(async () => {
    localServerUrl = await startLocalServer();
    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    // Pinned because the CORS suites in this process set an origin of their own.
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = localServerUrl;
    process.env.CLIENT_WEBHOOK_TIMEOUT_MS = '100';
    process.env.WEBHOOK_OUTBOX_QUEUE_NAME = queueName;
    process.env.WEBHOOK_OUTBOX_QUEUE_CONCURRENCY = '2';
    process.env.WEBHOOK_OUTBOX_WORKER_POLL_INTERVAL_MS = '100';
    process.env.WEBHOOK_OUTBOX_WORKER_BATCH_SIZE = '25';
    process.env.WEBHOOK_OUTBOX_WORKER_LEASE_MS = '6000';

    await openApp(AppMode.API_ONLY);
    await closeApp();
  });

  afterEach(async () => {
    capturedRequests.length = 0;
    responseMode = 'success';

    await clearQueue();

    if (app) {
      const source = dataSource();
      if (createdOutboxIds.size > 0) {
        await source.query('DELETE FROM client_webhook_outbox WHERE id = ANY($1::uuid[])', [
          Array.from(createdOutboxIds),
        ]);
      }
      if (createdOnboardingIds.size > 0) {
        await source.query(
          'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
          [Array.from(createdOnboardingIds)],
        );
        await source.query('DELETE FROM audit_log WHERE resource_id = ANY($1::text[])', [
          Array.from(createdOnboardingIds),
        ]);
        await source.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
      }
    }

    createdOutboxIds.clear();
    createdOnboardingIds.clear();
    await closeApp();
    await clearQueue();
  });

  afterAll(async () => {
    await closeApp();
    await clearQueue();
    await closeLocalServer();
  });

  it('does not start a consumer in api-only mode while leaving a queued row pending', async () => {
    await openApp(AppMode.API_ONLY);
    const onboardingId = await createOnboardingFixture();
    const outboxId = await createOutboxFixture({ onboardingId });

    await app!.get(WebhookQueueService).enqueue(outboxId);
    await waitForCondition(async () => (await readQueueWakeUps(outboxId)).length > 0);

    await expectNoRequestsFor(300);
    expect((await readOutboxRow(outboxId)).status).toBe(WebhookOutboxStatus.PENDING);
    expect((await readOutboxRow(outboxId)).attempts).toBe(0);
  });

  it('keeps a successful start transition with one pending outbox row while an audit rollback before notify leaves no rollback row', async () => {
    await openApp(AppMode.API_ONLY);

    const errorLoggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    const warnLoggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    try {
      const startResponse = await request(app!.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: 'base' })
        .expect(201);
      const committedOnboardingId = startResponse.body.onboardingId as string;
      createdOnboardingIds.add(committedOnboardingId);

      const startOutboxRows = await readOutboxRows(committedOnboardingId);
      expect(startOutboxRows).toHaveLength(1);
      expect(startOutboxRows[0]).toEqual(
        expect.objectContaining({
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
        }),
      );
      expect(capturedRequests).toHaveLength(0);

      const logMessages = [...errorLoggerSpy.mock.calls, ...warnLoggerSpy.mock.calls].map(
        ([message]) => String(message),
      );
      expect(
        logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED')),
      ).toBe(false);
      expect(
        logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED')),
      ).toBe(false);
    } finally {
      errorLoggerSpy.mockRestore();
      warnLoggerSpy.mockRestore();
    }

    const rollbackOnboardingId = await createOnboardingFixture({
      currentStep: 'accept_terms',
      context: { email: 'rollback@example.com' },
    });
    const auditService = app!.get(AuditService);
    const webhookService = app!.get(WebhookService);
    const auditSpy = jest
      .spyOn(auditService, 'log')
      .mockRejectedValueOnce(new Error('audit insert failed'));
    const notifyErrorSpy = jest
      .spyOn(webhookService, 'notifyError')
      .mockImplementationOnce(async () => undefined);

    try {
      await request(app!.getHttpServer())
        .post(`/v1/onboardings/${rollbackOnboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect(500);
    } finally {
      auditSpy.mockRestore();
      notifyErrorSpy.mockRestore();
    }

    expect(
      await dataSource().query(
        'SELECT status, current_step, context FROM onboardings WHERE id = $1',
        [rollbackOnboardingId],
      ),
    ).toEqual([
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'accept_terms',
        context: { email: 'rollback@example.com' },
      }),
    ]);
    expect(await readOutboxRows(rollbackOnboardingId)).toHaveLength(0);
  });

  it.each([AppMode.WORKER_ONLY, AppMode.ALL])(
    'claims and delivers a due row in %s mode with a stable event ID',
    async (mode) => {
      await openApp(mode);
      const onboardingId = await createOnboardingFixture();
      const payload = buildPayload(onboardingId);
      const outboxId = await createOutboxFixture({ onboardingId, payload });

      const wakeUp = await addQueueJob(outboxId);
      await waitForJobFinished(String(wakeUp.id));
      await waitForCondition(() =>
        readOutboxRow(outboxId).then((row) => row.status === 'DELIVERED'),
      );

      const row = await readOutboxRow(outboxId);
      expect(row.status).toBe(WebhookOutboxStatus.DELIVERED);
      expect(row.attempts).toBe(1);
      expect(row.delivered_at).not.toBeNull();
      expect(capturedRequests).toHaveLength(1);
      expect(capturedRequests[0]).toEqual(
        expect.objectContaining({
          method: 'POST',
          body: payload,
          headers: expect.objectContaining({
            'x-webhook-event-id': payload.event.id,
          }),
        }),
      );
    },
  );

  it('contains a queue wake-up failure from notify while leaving the row pending for reconciliation', async () => {
    await openApp(AppMode.WORKER_ONLY);

    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const queueService = app!.get(WebhookQueueService);
    const enqueueSpy = jest
      .spyOn(queueService, 'enqueue')
      .mockRejectedValueOnce(new Error('redis enqueue failed'));

    try {
      const startResponse = await request(app!.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: 'base' })
        .expect(201);
      const onboardingId = startResponse.body.onboardingId as string;
      createdOnboardingIds.add(onboardingId);

      const outboxRows = await readOutboxRows(onboardingId);
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0].status).toBe(WebhookOutboxStatus.PENDING);
      expect(outboxRows[0].attempts).toBe(0);

      const logMessages = loggerSpy.mock.calls.map(([message]) => String(message));
      expect(
        logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED')),
      ).toBe(true);
      expect(
        logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED')),
      ).toBe(false);

      await waitForCondition(() =>
        readOutboxRow(outboxRows[0].id).then((row) => row.status === 'DELIVERED'),
      );
      expect(capturedRequests).toHaveLength(1);
    } finally {
      enqueueSpy.mockRestore();
      loggerSpy.mockRestore();
    }
  });

  it('allows one conditional claim for duplicate jobs and ignores stale terminal jobs', async () => {
    await openApp(AppMode.WORKER_ONLY);
    const duplicateOnboardingId = await createOnboardingFixture();
    const duplicateOutboxId = await createOutboxFixture({ onboardingId: duplicateOnboardingId });

    const firstDuplicateWakeUp = await addQueueJob(duplicateOutboxId);
    const secondDuplicateWakeUp = await addQueueJob(duplicateOutboxId);
    await waitForJobFinished(String(firstDuplicateWakeUp.id));
    await waitForJobFinished(String(secondDuplicateWakeUp.id));
    await waitForCondition(() =>
      readOutboxRow(duplicateOutboxId).then((row) => row.status === 'DELIVERED'),
    );

    const deliveredOnboardingId = await createOnboardingFixture();
    const deliveredOutboxId = await createOutboxFixture({
      onboardingId: deliveredOnboardingId,
      status: WebhookOutboxStatus.DELIVERED,
      attempts: 1,
    });
    const errorOnboardingId = await createOnboardingFixture();
    const errorOutboxId = await createOutboxFixture({
      onboardingId: errorOnboardingId,
      status: WebhookOutboxStatus.ERROR,
      attempts: 5,
      nextDeliveryAt: null,
      deliveredAt: null,
    });

    const deliveredWakeUp = await addQueueJob(deliveredOutboxId);
    const errorWakeUp = await addQueueJob(errorOutboxId);
    await waitForJobFinished(String(deliveredWakeUp.id));
    await waitForJobFinished(String(errorWakeUp.id));

    expect(capturedRequests).toHaveLength(1);
    expect((await readOutboxRow(deliveredOutboxId)).status).toBe(WebhookOutboxStatus.DELIVERED);
    expect((await readOutboxRow(errorOutboxId)).status).toBe(WebhookOutboxStatus.ERROR);
  });

  it('re-enqueues a due pending row with a fresh wake-up while the failed wake-up remains retained', async () => {
    await openApp(AppMode.WORKER_ONLY);
    responseMode = 'failure';
    const onboardingId = await createOnboardingFixture();
    const outboxId = await createOutboxFixture({ onboardingId, baseDelayMs: 5000 });

    const firstWakeUp = await addQueueJob(outboxId);
    const firstWakeUpId = String(firstWakeUp.id);

    await waitForJobFinished(firstWakeUpId);
    await waitForCondition(() =>
      readOutboxRow(outboxId).then((row) => row.status === WebhookOutboxStatus.PENDING),
    );

    const failedRow = await readOutboxRow(outboxId);
    expect(failedRow.attempts).toBe(1);
    expect(failedRow.next_delivery_at).not.toBeNull();

    expect(await readQueueJobState(firstWakeUpId)).toBe('failed');

    await expectNoRequestsFor(300);

    responseMode = 'success';
    await dataSource().query(
      "UPDATE client_webhook_outbox SET next_delivery_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [outboxId],
    );

    await waitForCondition(async () => {
      const wakeUps = await readQueueWakeUps(outboxId);
      return wakeUps.some((wakeUp) => wakeUp.id !== firstWakeUpId);
    });

    const freshWakeUps = await readQueueWakeUps(outboxId);
    const secondWakeUp = freshWakeUps.find((wakeUp) => wakeUp.id !== firstWakeUpId);
    expect(secondWakeUp).toBeDefined();
    expect(secondWakeUp?.id).not.toBe(firstWakeUpId);

    expect(await readQueueJobState(firstWakeUpId)).toBe('failed');

    expect(app!.get(RetryService)).toBeInstanceOf(RetryService);

    await waitForCondition(() => readOutboxRow(outboxId).then((row) => row.status === 'DELIVERED'));

    expect((await readOutboxRow(outboxId)).attempts).toBe(2);
    expect(capturedRequests).toHaveLength(2);
  });

  it('terminalizes stale sending leases as ERROR without sending HTTP', async () => {
    await openApp(AppMode.WORKER_ONLY);
    const onboardingId = await createOnboardingFixture();
    const outboxId = await createOutboxFixture({
      onboardingId,
      status: WebhookOutboxStatus.SENDING,
      attempts: 1,
      sendingStartedAt: new Date(Date.now() - 120000).toISOString(),
      nextDeliveryAt: null,
    });

    await waitForCondition(() => readOutboxRow(outboxId).then((row) => row.status === 'ERROR'));

    expect(await readOutboxRow(outboxId)).toEqual(
      expect.objectContaining({
        status: WebhookOutboxStatus.ERROR,
        attempts: 1,
        sending_started_at: null,
        next_delivery_at: null,
        delivered_at: null,
      }),
    );
    expect(capturedRequests).toHaveLength(0);
  });

  it('keeps non-due rows pending until PostgreSQL says they are due', async () => {
    await openApp(AppMode.WORKER_ONLY);
    const onboardingId = await createOnboardingFixture();
    const outboxId = await createOutboxFixture({
      onboardingId,
      nextDeliveryAt: new Date(Date.now() + 60000).toISOString(),
    });

    const wakeUp = await addQueueJob(outboxId);
    await waitForJobFinished(String(wakeUp.id));
    await expectNoRequestsFor(300);
    expect((await readOutboxRow(outboxId)).status).toBe(WebhookOutboxStatus.PENDING);
  });

  it('initializes the extracted delivery service in a real worker-capable module', async () => {
    await openApp(AppMode.WORKER_ONLY);

    expect(app!.get(HttpDeliveryService)).toBeInstanceOf(HttpDeliveryService);
    expect(app!.get(WebhookQueueService)).toBeInstanceOf(WebhookQueueService);
    expect(app!.get(WebhookService)).toBeInstanceOf(WebhookService);
  });

  it('waits for active reconciliation poll on app.close before queue shutdown', async () => {
    await openApp(AppMode.WORKER_ONLY);

    const queueService = app!.get(WebhookQueueService);
    const retryWorker = app!.get(RetryService);
    const retryDestroySpy = jest.spyOn(retryWorker, 'onModuleDestroy');
    const queueShutdownSpy = jest.spyOn(queueService, 'onApplicationShutdown');

    const onboardingId = await createOnboardingFixture();
    await createOutboxFixture({ onboardingId });

    let releaseEnqueue: (() => void) | null = null;
    const enqueueGate = new Promise<void>((resolve) => {
      releaseEnqueue = resolve;
    });
    const enqueueSpy = jest
      .spyOn(queueService, 'enqueue')
      .mockImplementationOnce(async () => enqueueGate);

    await waitForCondition(() => enqueueSpy.mock.calls.length > 0);

    let isClosed = false;
    const closePromise = app!.close().then(() => {
      isClosed = true;
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(isClosed).toBe(false);

    releaseEnqueue?.();
    await closePromise;
    app = null;

    expect(retryDestroySpy).toHaveBeenCalled();
    expect(queueShutdownSpy).toHaveBeenCalled();
    expect(retryDestroySpy.mock.invocationCallOrder[0]).toBeLessThan(
      queueShutdownSpy.mock.invocationCallOrder[0],
    );

    enqueueSpy.mockRestore();
    retryDestroySpy.mockRestore();
    queueShutdownSpy.mockRestore();
  });
});
