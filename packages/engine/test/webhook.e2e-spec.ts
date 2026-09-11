import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebhookEventPayload, WebhookEventType } from '../src/webhook/webhook-event';
import { WebhookOutboxStatus } from '../src/webhook/entity/webhook-outbox.entity';
import { HttpDeliveryService } from '../src/webhook/delivery/http-delivery.service';
import { WebhookQueueService } from '../src/webhook/webhook-queue.service';
import { WebhookRepository } from '../src/webhook/webhook.repository';
import { WebhookService } from '../src/webhook/webhook.service';
import { OnboardingEntity } from '../src/onboardings/entity/onboarding.entity';
import { startE2eServer } from './e2e-server';

type CapturedRequest = {
  method: string;
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
};

type OutboxRow = {
  id: string;
  onboarding_id: string;
  event_type: WebhookEventType;
  endpoint_url: string;
  payload: WebhookEventPayload;
  status: WebhookOutboxStatus;
  attempts: number;
  max_attempts: number;
  base_delay_ms: number;
  backoff_multiplier: number;
  max_backoff_ms: number;
  next_delivery_at: string | null;
  sending_started_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_TIMEOUT_MS = '150';

/**
 * Re-checks on a timer rather than on `setImmediate`. What these conditions wait for — a delivery
 * attempt and the row it updates — runs on this same event loop, and a `setImmediate` loop
 * re-queries the database as fast as the loop will turn it round, starving the work being waited
 * on of the turns it needs to finish. A runner sharing its cores with the other packages' e2e
 * suites is where that becomes the difference between waiting and timing out.
 */
const POLL_INTERVAL_MS = 25;

const waitForCondition = async (
  condition: () => boolean | Promise<boolean>,
  timeoutMs = 5000,
): Promise<void> => {
  const startedAt = Date.now();
  let elapsedMs = 0;

  while (elapsedMs <= timeoutMs) {
    if (await condition()) {
      return;
    }

    await new Promise<void>((resolve) => {
      setTimeout(resolve, POLL_INTERVAL_MS);
    });

    elapsedMs = Date.now() - startedAt;
  }

  throw new Error('Timed out waiting for test condition');
};

describe('WebhookService delivery integration', () => {
  let app: NestExpressApplication | null = null;
  let localServer: Server;
  let localServerUrl = '';
  let holdRequestRelease: (() => void) | null = null;
  const createdOnboardingIds = new Set<string>();
  const createdOutboxIds = new Set<string>();
  const capturedRequests: CapturedRequest[] = [];

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const dataSource = (): DataSource => getApp().get(DataSource);

  const readRawRequestBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
  };

  const requestHandler = async (request: IncomingMessage, response: ServerResponse) => {
    const parsedUrl = new URL(request.url ?? '/', localServerUrl || 'http://127.0.0.1');

    if (parsedUrl.pathname === '/timeout') {
      return;
    }

    const rawBody = await readRawRequestBody(request);
    let parsedBody: unknown = rawBody;
    if (rawBody.length > 0) {
      try {
        parsedBody = JSON.parse(rawBody);
      } catch {
        parsedBody = rawBody;
      }
    }

    capturedRequests.push({
      method: request.method ?? '',
      path: parsedUrl.pathname,
      headers: request.headers,
      body: parsedBody,
    });

    if (parsedUrl.pathname === '/hold') {
      await new Promise<void>((resolve) => {
        holdRequestRelease = resolve;
      });
    }

    if (parsedUrl.pathname === '/non-2xx') {
      response.statusCode = 503;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'upstream-unavailable' }));
      return;
    }

    response.statusCode = 204;
    response.end();
  };

  const startLocalServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      localServer = createServer((request, response) => {
        void requestHandler(request, response);
      });

      localServer.once('error', reject);
      localServer.listen(0, '127.0.0.1', () => {
        const address = localServer.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve test server address'));
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
      localServer.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  const createOnboardingFixture = async (id: string) => {
    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [id]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [id]);

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
      [id, 'base', 1, 'awaiting_user', 'collect_email', '{}', null, null],
    );
    createdOnboardingIds.add(id);
  };

  const createOutboxFixture = async (params: {
    id: string;
    onboardingId: string;
    endpointUrl: string;
    payload: WebhookEventPayload;
    status?: WebhookOutboxStatus;
    attempts?: number;
    maxAttempts?: number;
    baseDelayMs?: number;
    backoffMultiplier?: number;
    maxBackoffMs?: number;
    nextDeliveryAt?: string | null;
    sendingStartedAt?: string | null;
    deliveredAt?: string | null;
  }) => {
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
        params.id,
        params.onboardingId,
        params.payload.event.type,
        params.endpointUrl,
        JSON.stringify(params.payload),
        params.status ?? WebhookOutboxStatus.PENDING,
        params.attempts ?? 0,
        params.maxAttempts ?? 5,
        params.baseDelayMs ?? 5000,
        params.backoffMultiplier ?? 2,
        params.maxBackoffMs ?? 300000,
        params.nextDeliveryAt ?? null,
        params.sendingStartedAt ??
          (params.status === WebhookOutboxStatus.SENDING ? new Date().toISOString() : null),
        params.deliveredAt ?? null,
      ],
    );
    createdOutboxIds.add(params.id);
  };

  const readOutboxRow = async (outboxId: string): Promise<OutboxRow> => {
    const rows = (await dataSource().query('SELECT * FROM client_webhook_outbox WHERE id = $1', [
      outboxId,
    ])) as OutboxRow[];

    if (rows.length !== 1) {
      throw new Error(`Expected one outbox row for id ${outboxId}`);
    }

    return rows[0];
  };

  const buildPayload = (params: {
    eventId: string;
    onboardingId: string;
    eventType: WebhookEventType;
    status?: 'awaiting_user' | 'approved';
    currentStep?: string | null;
    completedAt?: string | null;
  }): WebhookEventPayload => ({
    version: 1,
    event: {
      id: params.eventId,
      type: params.eventType,
      occurredAt: '2026-07-21T10:00:00.000Z',
    },
    onboarding: {
      id: params.onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: params.status ?? 'awaiting_user',
      currentStep: params.currentStep ?? 'collect_email',
      completedAt: params.completedAt ?? null,
    },
  });

  const assertNoResponseOrErrorBodyStored = (row: OutboxRow) => {
    expect(row).not.toHaveProperty('response_body');
    expect(row).not.toHaveProperty('error_body');
    expect(row.payload).not.toHaveProperty('responseBody');
    expect(row.payload).not.toHaveProperty('errorBody');
    expect(row.payload).not.toHaveProperty('context');
    expect(row.payload).not.toHaveProperty('submittedData');
    expect(row.payload).not.toHaveProperty('connectorPayload');
  };

  const notifyService = (): WebhookService => getApp().get(WebhookService);

  const deliveryService = (): HttpDeliveryService => getApp().get(HttpDeliveryService);

  beforeAll(async () => {
    localServerUrl = await startLocalServer();

    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.CLIENT_WEBHOOK_BASE_URL = localServerUrl;
    process.env.CLIENT_WEBHOOK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );

    await startE2eServer(app);
  });

  afterEach(async () => {
    capturedRequests.length = 0;
    holdRequestRelease = null;

    if (app && createdOutboxIds.size > 0) {
      await dataSource().query('DELETE FROM client_webhook_outbox WHERE id = ANY($1::uuid[])', [
        Array.from(createdOutboxIds),
      ]);
      createdOutboxIds.clear();
    }

    if (app && createdOnboardingIds.size > 0) {
      await dataSource().query(
        'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
        [Array.from(createdOnboardingIds)],
      );
      await dataSource().query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
        Array.from(createdOnboardingIds),
      ]);
      createdOnboardingIds.clear();
    }
  });

  afterAll(async () => {
    await closeLocalServer();

    if (app) {
      await app.close();
    }
  });

  const getWebhookRepository = () => getApp().get(WebhookRepository);

  const workflowWithNotifyPath = (path: string) =>
    ({
      getRootNotifyWebhook: () => ({ path }),
      getEffectiveNotifyWebhookForTransition: () => ({ path }),
    }) as Parameters<WebhookService['notify']>[1];

  const readOutboxRowById = async (outboxId: string) =>
    getWebhookRepository().findById(dataSource().manager, outboxId);

  const readOutboxRowsForOnboarding = async (onboardingId: string): Promise<OutboxRow[]> =>
    (await dataSource().query(
      'SELECT * FROM client_webhook_outbox WHERE onboarding_id = $1 ORDER BY created_at ASC',
      [onboardingId],
    )) as OutboxRow[];

  it('contains outbox persistence failures in notify without leaking webhook details', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003201';
    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const webhookRepository = getApp().get(WebhookRepository);
    jest
      .spyOn(webhookRepository, 'createPending')
      .mockRejectedValueOnce(new Error('db insert failed'));

    await expect(
      notifyService().notify(
        {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          completedAt: onboarding.completedAt,
        },
        workflowWithNotifyPath('/hold'),
      ),
    ).resolves.toBeUndefined();

    const logMessages = loggerSpy.mock.calls.map(([message]) => String(message));
    expect(
      logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED')),
    ).toBe(true);
    expect(logMessages.some((message) => message.includes('/hold'))).toBe(false);
    expect(logMessages.some((message) => message.includes('payload'))).toBe(false);
    expect(logMessages.some((message) => message.includes('secret'))).toBe(false);
    expect(logMessages.some((message) => message.includes('https://'))).toBe(false);
    expect(capturedRequests).toHaveLength(0);
    expect(await readOutboxRowsForOnboarding(onboardingId)).toHaveLength(0);
    loggerSpy.mockRestore();
  });

  it('persists a due pending intent without delivering it in api-only notify', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003202';
    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });

    await notifyService().notify(
      {
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        completedAt: onboarding.completedAt,
      },
      workflowWithNotifyPath('/hold'),
    );

    expect(capturedRequests).toHaveLength(0);

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(1);

    const persistedAfterNotify = await readOutboxRowById(outboxRows[0].id);

    expect(persistedAfterNotify).toEqual(
      expect.objectContaining({
        endpointUrl: `${localServerUrl}/hold`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        deliveredAt: null,
        nextDeliveryAt: expect.any(Date),
      }),
    );
  });

  it('contains queue wake-up failures in notifyError without leaking webhook details', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003203';
    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });
    onboarding.capturePreMutationWebhookSnapshot();
    onboarding.status = 'approved';
    onboarding.currentStep = null;
    onboarding.completedAt = new Date('2026-07-22T10:00:00.000Z');

    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const webhookQueueService = getApp().get(WebhookQueueService);
    jest
      .spyOn(webhookQueueService, 'enqueue')
      .mockRejectedValueOnce(new Error('redis enqueue failed'));

    await expect(
      notifyService().notifyError(new Error('lifecycle failed'), onboarding, {
        getRootNotifyWebhook: () => ({ path: '/hold' }),
      } as Parameters<WebhookService['notifyError']>[2]),
    ).resolves.toBeUndefined();

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    const logMessages = loggerSpy.mock.calls.map(([message]) => String(message));
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0].status).toBe(WebhookOutboxStatus.PENDING);
    expect(
      logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED')),
    ).toBe(true);
    expect(
      logMessages.some((message) => message.includes('CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED')),
    ).toBe(false);
    expect(logMessages.some((message) => message.includes('/hold'))).toBe(false);
    expect(logMessages.some((message) => message.includes('payload'))).toBe(false);
    expect(logMessages.some((message) => message.includes('secret'))).toBe(false);
    expect(logMessages.some((message) => message.includes('https://'))).toBe(false);
    expect(capturedRequests).toHaveLength(0);
    loggerSpy.mockRestore();
  });

  it('leaves a pending intent untouched when api-only notify does not deliver', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003204';

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });

    await notifyService().notify(
      {
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        completedAt: onboarding.completedAt,
      },
      workflowWithNotifyPath('/non-2xx'),
    );

    expect(capturedRequests).toHaveLength(0);

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(1);

    const persisted = await readOutboxRowById(outboxRows[0].id);
    expect(persisted).toEqual(
      expect.objectContaining({
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        deliveredAt: null,
        nextDeliveryAt: expect.any(Date),
        sendingStartedAt: null,
      }),
    );
    expect(persisted?.nextDeliveryAt?.getTime()).toBeLessThanOrEqual(Date.now());
    expect(persisted?.maxAttempts).toBe(5);
    expect(persisted?.baseDelayMs).toBe(5000);
    expect(persisted?.backoffMultiplier).toBe(2);
    expect(persisted?.maxBackoffMs).toBe(300000);
    assertNoResponseOrErrorBodyStored(persisted as unknown as OutboxRow);
  });

  it('persists pending delivery intents without attempting HTTP delivery', async () => {
    const connectionOnboardingId = '00000000-0000-4000-8000-000000003205';
    const timeoutOnboardingId = '00000000-0000-4000-8000-000000003235';

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      connectionOnboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [connectionOnboardingId]);
    await createOnboardingFixture(connectionOnboardingId);
    const connectionOnboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: connectionOnboardingId });

    await expect(
      notifyService().notify(
        {
          id: connectionOnboarding.id,
          workflowId: connectionOnboarding.workflowId,
          workflowVersion: connectionOnboarding.workflowVersion,
          status: connectionOnboarding.status,
          currentStep: connectionOnboarding.currentStep,
          completedAt: connectionOnboarding.completedAt,
        },
        workflowWithNotifyPath('http://127.0.0.1:65535/connection-failure'),
      ),
    ).resolves.toBeUndefined();

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      timeoutOnboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [timeoutOnboardingId]);
    await createOnboardingFixture(timeoutOnboardingId);
    const timeoutOnboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: timeoutOnboardingId });

    await expect(
      notifyService().notify(
        {
          id: timeoutOnboarding.id,
          workflowId: timeoutOnboarding.workflowId,
          workflowVersion: timeoutOnboarding.workflowVersion,
          status: timeoutOnboarding.status,
          currentStep: timeoutOnboarding.currentStep,
          completedAt: timeoutOnboarding.completedAt,
        },
        workflowWithNotifyPath('/timeout'),
      ),
    ).resolves.toBeUndefined();

    expect(capturedRequests).toHaveLength(0);

    const connectionOutboxRows = await readOutboxRowsForOnboarding(connectionOnboardingId);
    expect(connectionOutboxRows).toHaveLength(1);
    const connectionRow = await readOutboxRow(connectionOutboxRows[0].id);
    expect(connectionRow.status).toBe(WebhookOutboxStatus.PENDING);
    expect(connectionRow.attempts).toBe(0);
    expect(connectionRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(connectionRow);

    const timeoutOutboxRows = await readOutboxRowsForOnboarding(timeoutOnboardingId);
    expect(timeoutOutboxRows).toHaveLength(1);
    const timeoutRow = await readOutboxRow(timeoutOutboxRows[0].id);
    expect(timeoutRow.status).toBe(WebhookOutboxStatus.PENDING);
    expect(timeoutRow.attempts).toBe(0);
    expect(timeoutRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(timeoutRow);
  });

  it('reclaims due pending rows on worker delivery and increments attempts before delivery', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003205';
    const outboxId = '00000000-0000-4000-8000-000000003215';

    await createOnboardingFixture(onboardingId);
    const payload = buildPayload({
      eventId: '00000000-0000-4000-8000-000000003225',
      onboardingId,
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
    });
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/non-2xx`,
      payload,
      status: WebhookOutboxStatus.PENDING,
      attempts: 1,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(deliveryService().deliverDue(outboxId)).rejects.toThrow();

    const rowAfterDelivery = await readOutboxRow(outboxId);
    expect(rowAfterDelivery.status).toBe(WebhookOutboxStatus.PENDING);
    expect(rowAfterDelivery.attempts).toBe(2);
    expect(rowAfterDelivery.delivered_at).toBeNull();
  });

  it('does not deliver non-pending rows via due delivery', async () => {
    const deliveredOnboardingId = '00000000-0000-4000-8000-000000003206';
    const deliveredOutboxId = '00000000-0000-4000-8000-000000003216';
    const sendingOnboardingId = '00000000-0000-4000-8000-000000003207';
    const sendingOutboxId = '00000000-0000-4000-8000-000000003217';
    const errorOnboardingId = '00000000-0000-4000-8000-000000003208';
    const errorOutboxId = '00000000-0000-4000-8000-000000003218';

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      deliveredOnboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [deliveredOnboardingId]);
    await createOnboardingFixture(deliveredOnboardingId);
    await createOutboxFixture({
      id: deliveredOutboxId,
      onboardingId: deliveredOnboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003226',
        onboardingId: deliveredOnboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      status: WebhookOutboxStatus.DELIVERED,
      attempts: 1,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
      deliveredAt: '2026-07-21T10:00:00.000Z',
    });

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      sendingOnboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [sendingOnboardingId]);
    await createOnboardingFixture(sendingOnboardingId);
    await createOutboxFixture({
      id: sendingOutboxId,
      onboardingId: sendingOnboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003227',
        onboardingId: sendingOnboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      status: WebhookOutboxStatus.SENDING,
      attempts: 1,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      errorOnboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [errorOnboardingId]);
    await createOnboardingFixture(errorOnboardingId);
    await createOutboxFixture({
      id: errorOutboxId,
      onboardingId: errorOnboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003228',
        onboardingId: errorOnboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      status: WebhookOutboxStatus.ERROR,
      attempts: 5,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    await deliveryService().deliverDue(deliveredOutboxId);
    await deliveryService().deliverDue(sendingOutboxId);
    await deliveryService().deliverDue(errorOutboxId);

    expect(capturedRequests).toHaveLength(0);

    const deliveredRow = await readOutboxRow(deliveredOutboxId);
    expect(deliveredRow.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(deliveredRow.attempts).toBe(1);

    const sendingRow = await readOutboxRow(sendingOutboxId);
    expect(sendingRow.status).toBe(WebhookOutboxStatus.SENDING);
    expect(sendingRow.attempts).toBe(1);

    const errorRow = await readOutboxRow(errorOutboxId);
    expect(errorRow.status).toBe(WebhookOutboxStatus.ERROR);
    expect(errorRow.attempts).toBe(5);
  });

  it('does nothing before due time and delivers once when a pending row is due', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003209';
    const outboxId = '00000000-0000-4000-8000-000000003219';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003229',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      attempts: 1,
      nextDeliveryAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(deliveryService().deliverDue(outboxId)).resolves.toBeUndefined();
    expect(capturedRequests).toHaveLength(0);

    await dataSource().query(
      "UPDATE client_webhook_outbox SET next_delivery_at = CURRENT_TIMESTAMP - INTERVAL '1 second' WHERE id = $1",
      [outboxId],
    );
    await expect(deliveryService().deliverDue(outboxId)).resolves.toBeUndefined();

    expect(capturedRequests).toHaveLength(1);
    const row = await readOutboxRow(outboxId);
    expect(row.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(row.attempts).toBe(2);
    expect(row.delivered_at).not.toBeNull();
    expect(row.next_delivery_at).toBeNull();
    expect(row.sending_started_at).toBeNull();
    assertNoResponseOrErrorBodyStored(row);
  });

  it('allows exactly one concurrent due claim and HTTP request', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003210';
    const outboxId = '00000000-0000-4000-8000-000000003220';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/hold`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003230',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    const firstDelivery = deliveryService().deliverDue(outboxId);
    await waitForCondition(() => capturedRequests.length === 1);
    const secondDelivery = deliveryService().deliverDue(outboxId);

    await expect(secondDelivery).resolves.toBeUndefined();
    const claimedRow = await readOutboxRow(outboxId);
    expect(capturedRequests).toHaveLength(1);
    expect(claimedRow.status).toBe(WebhookOutboxStatus.SENDING);
    expect(claimedRow.attempts).toBe(1);

    holdRequestRelease?.();
    await expect(firstDelivery).resolves.toBeUndefined();
    const deliveredRow = await readOutboxRow(outboxId);
    expect(deliveredRow.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(deliveredRow.attempts).toBe(1);
  });

  it('moves the fifth failed send to ERROR and skips subsequent due delivery', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003211';
    const outboxId = '00000000-0000-4000-8000-000000003221';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/non-2xx`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003231',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      attempts: 4,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(deliveryService().deliverDue(outboxId)).rejects.toThrow();
    expect(capturedRequests).toHaveLength(1);
    const errorRow = await readOutboxRow(outboxId);
    expect(errorRow.status).toBe(WebhookOutboxStatus.ERROR);
    expect(errorRow.attempts).toBe(5);
    expect(errorRow.next_delivery_at).toBeNull();
    expect(errorRow.sending_started_at).toBeNull();
    assertNoResponseOrErrorBodyStored(errorRow);

    await expect(deliveryService().deliverDue(outboxId)).resolves.toBeUndefined();
    expect(capturedRequests).toHaveLength(1);
  });

  it('expires a stale sending lease without making an HTTP request', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003212';
    const outboxId = '00000000-0000-4000-8000-000000003222';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003232',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      status: WebhookOutboxStatus.SENDING,
      attempts: 1,
      sendingStartedAt: new Date(Date.now() - 120_000).toISOString(),
    });

    const expiredCount = await dataSource().transaction((manager) =>
      getWebhookRepository().expireStaleSendingLeases(manager, 60_000),
    );

    expect(expiredCount).toBe(1);
    expect(capturedRequests).toHaveLength(0);
    const row = await readOutboxRow(outboxId);
    expect(row.status).toBe(WebhookOutboxStatus.ERROR);
    expect(row.sending_started_at).toBeNull();
    expect(row.next_delivery_at).toBeNull();
    assertNoResponseOrErrorBodyStored(row);
  });

  it('leaves ERROR after lease expiry when a late successful finalizer completes', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003213';
    const outboxId = '00000000-0000-4000-8000-000000003223';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/hold`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003233',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    const delivery = deliveryService().deliverDue(outboxId);
    await waitForCondition(() => capturedRequests.length === 1);
    await dataSource().query(
      "UPDATE client_webhook_outbox SET sending_started_at = CURRENT_TIMESTAMP - INTERVAL '2 minutes' WHERE id = $1",
      [outboxId],
    );
    await dataSource().transaction((manager) =>
      getWebhookRepository().expireStaleSendingLeases(manager, 60_000),
    );

    holdRequestRelease?.();
    await expect(delivery).resolves.toBeUndefined();
    const row = await readOutboxRow(outboxId);
    expect(row.status).toBe(WebhookOutboxStatus.ERROR);
    expect(row.delivered_at).toBeNull();
    expect(row.sending_started_at).toBeNull();
    expect(row.next_delivery_at).toBeNull();
    expect(capturedRequests).toHaveLength(1);
  });

  it('rejects invalid retry, status, lease, and delivery timestamp combinations', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003214';
    const outboxId = '00000000-0000-4000-8000-000000003224';
    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003234',
        onboardingId,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
    });

    const invalidUpdates = [
      'attempts = -1',
      'max_attempts = 0',
      'base_delay_ms = -1',
      'backoff_multiplier = 0',
      'base_delay_ms = 300001, max_backoff_ms = 300000',
      "status = 'PENDING', sending_started_at = CURRENT_TIMESTAMP",
      "status = 'ERROR', delivered_at = CURRENT_TIMESTAMP",
      "status = 'INVALID'",
    ];

    for (const update of invalidUpdates) {
      await expect(
        dataSource().query(`UPDATE client_webhook_outbox SET ${update} WHERE id = $1`, [outboxId]),
      ).rejects.toThrow();
    }
  });

  it('allows exactly one concurrent due claim and request for a pending row while the winner remains in flight', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003208';
    const outboxId = '00000000-0000-4000-8000-000000003218';

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);
    const payload = buildPayload({
      eventId: '00000000-0000-4000-8000-000000003228',
      onboardingId,
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
    });
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/hold`,
      payload,
      status: WebhookOutboxStatus.PENDING,
      attempts: 1,
      nextDeliveryAt: new Date(Date.now() - 1000).toISOString(),
    });

    const firstDelivery = deliveryService().deliverDue(outboxId);
    await waitForCondition(() => capturedRequests.length === 1);

    const secondDelivery = deliveryService().deliverDue(outboxId);
    await expect(secondDelivery).resolves.toBeUndefined();

    let persistedWhileHeld = await readOutboxRow(outboxId);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].path).toBe('/hold');
    expect(persistedWhileHeld.status).toBe(WebhookOutboxStatus.SENDING);
    expect(persistedWhileHeld.attempts).toBe(2);
    expect(persistedWhileHeld.delivered_at).toBeNull();

    holdRequestRelease?.();
    await expect(firstDelivery).resolves.toBeUndefined();

    persistedWhileHeld = await readOutboxRow(outboxId);
    expect(capturedRequests).toHaveLength(1);
    expect(persistedWhileHeld.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(persistedWhileHeld.attempts).toBe(2);
    expect(persistedWhileHeld.delivered_at).not.toBeNull();
  });
});
