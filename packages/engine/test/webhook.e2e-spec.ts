import path from 'node:path';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { WebhookEventPayload, WebhookEventType } from '../src/webhook/webhook-event';
import { WebhookOutboxStatus } from '../src/webhook/entity/webhook-outbox.entity';
import { WebhookRepository } from '../src/webhook/webhook.repository';
import { WebhookService } from '../src/webhook/webhook.service';
import { OnboardingEntity } from '../src/onboardings/entity/onboarding.entity';

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
  event_type: WebhookEventType;
  endpoint_url: string;
  payload: WebhookEventPayload;
  status: WebhookOutboxStatus;
  attempts: number;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_TIMEOUT_MS = '150';

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
      setImmediate(resolve);
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
         created_at,
         updated_at,
         delivered_at
       ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW(), NOW(), $8)`,
      [
        params.id,
        params.onboardingId,
        params.payload.event.type,
        params.endpointUrl,
        JSON.stringify(params.payload),
        params.status ?? WebhookOutboxStatus.PENDING,
        params.attempts ?? 0,
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

  beforeAll(async () => {
    localServerUrl = await startLocalServer();

    process.env.NODE_ENV = 'test';
    process.env.MODE = 'api-only';
    process.env.PORT = '3000';
    process.env.DATABASE_URL =
      'postgres://orchestrator:orchestrator_pass@127.0.0.1:5432/orchestrator?sslmode=disable';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
    process.env.STORAGE_DRIVER = 's3';
    process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
    process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', 'workflows');
    process.env.CLIENT_WEBHOOK_BASE_URL = localServerUrl;
    process.env.CLIENT_WEBHOOK_TIMEOUT_MS = DEFAULT_TIMEOUT_MS;
    process.env.AUDIT_ADMIN_API_KEY = 'webhook-e2e-audit-admin-key';
    process.env.AUDIT_NON_ADMIN_API_KEY = 'webhook-e2e-audit-non-admin-key';

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

    await app.init();
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
      'SELECT id, onboarding_id, event_type, endpoint_url, payload, status, attempts, delivered_at FROM client_webhook_outbox WHERE onboarding_id = $1 ORDER BY created_at ASC',
      [onboardingId],
    )) as OutboxRow[];

  it('persists a pending intent and immediately delivers it in notify', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003201';
    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });

    const deliveryPromise = notifyService().notify(
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

    await waitForCondition(() => capturedRequests.length === 1);
    holdRequestRelease?.();
    await deliveryPromise;

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].method).toBe('POST');
    expect(capturedRequests[0].path).toBe('/hold');

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(1);

    const persistedAfterNotify = await readOutboxRowById(outboxRows[0].id);

    expect(capturedRequests[0].body).toEqual(persistedAfterNotify?.payload);
    expect(persistedAfterNotify).toEqual(
      expect.objectContaining({
        endpointUrl: `${localServerUrl}/hold`,
        status: WebhookOutboxStatus.DELIVERED,
        attempts: 1,
        deliveredAt: expect.any(Date),
        payload: capturedRequests[0].body,
      }),
    );
  });

  it('restores pending with one attempt and no response or error body after failed immediate delivery', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003202';

    await dataSource().query('DELETE FROM client_webhook_outbox WHERE onboarding_id = $1', [
      onboardingId,
    ]);
    await dataSource().query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
    await createOnboardingFixture(onboardingId);

    const onboarding = await dataSource()
      .getRepository(OnboardingEntity)
      .findOneByOrFail({ id: onboardingId });

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
        workflowWithNotifyPath('/non-2xx'),
      ),
    ).resolves.toBeUndefined();

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].path).toBe('/non-2xx');

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(1);

    const persisted = await readOutboxRowById(outboxRows[0].id);
    expect(persisted).toEqual(
      expect.objectContaining({
        status: WebhookOutboxStatus.PENDING,
        attempts: 1,
        deliveredAt: null,
      }),
    );
    assertNoResponseOrErrorBodyStored(persisted as unknown as OutboxRow);
  });

  it('restores pending with one attempt on connection failure and timeout', async () => {
    const connectionOnboardingId = '00000000-0000-4000-8000-000000003203';
    const timeoutOnboardingId = '00000000-0000-4000-8000-000000003204';

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
    expect(connectionRow.attempts).toBe(1);
    expect(connectionRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(connectionRow);

    const timeoutOutboxRows = await readOutboxRowsForOnboarding(timeoutOnboardingId);
    expect(timeoutOutboxRows).toHaveLength(1);
    const timeoutRow = await readOutboxRow(timeoutOutboxRows[0].id);
    expect(timeoutRow.status).toBe(WebhookOutboxStatus.PENDING);
    expect(timeoutRow.attempts).toBe(1);
    expect(timeoutRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(timeoutRow);
  });

  it('reclaims pending rows on resend and increments attempts before delivery', async () => {
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
    });

    await expect(notifyService().resend(outboxId)).rejects.toThrow();

    const rowAfterResend = await readOutboxRow(outboxId);
    expect(rowAfterResend.status).toBe(WebhookOutboxStatus.PENDING);
    expect(rowAfterResend.attempts).toBe(2);
    expect(rowAfterResend.delivered_at).toBeNull();
  });

  it('does not resend delivered or sending events and preserves the unknown-id contract', async () => {
    const deliveredOnboardingId = '00000000-0000-4000-8000-000000003206';
    const deliveredOutboxId = '00000000-0000-4000-8000-000000003216';
    const sendingOnboardingId = '00000000-0000-4000-8000-000000003207';
    const sendingOutboxId = '00000000-0000-4000-8000-000000003217';

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
    });

    await notifyService().resend(deliveredOutboxId);
    await notifyService().resend(sendingOutboxId);

    expect(capturedRequests).toHaveLength(0);

    await expect(
      notifyService().resend('00000000-0000-4000-8000-000000009999'),
    ).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
        message: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
      },
    });

    const deliveredRow = await readOutboxRow(deliveredOutboxId);
    expect(deliveredRow.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(deliveredRow.attempts).toBe(1);

    const sendingRow = await readOutboxRow(sendingOutboxId);
    expect(sendingRow.status).toBe(WebhookOutboxStatus.SENDING);
    expect(sendingRow.attempts).toBe(1);
  });

  it('allows exactly one concurrent resend claim and request for a pending row while the winner remains in flight', async () => {
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
    });

    const firstResend = notifyService().resend(outboxId);
    await waitForCondition(() => capturedRequests.length === 1);

    const secondResend = notifyService().resend(outboxId);
    await expect(secondResend).resolves.toBeUndefined();

    let persistedWhileHeld = await readOutboxRow(outboxId);
    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].path).toBe('/hold');
    expect(persistedWhileHeld.status).toBe(WebhookOutboxStatus.SENDING);
    expect(persistedWhileHeld.attempts).toBe(2);
    expect(persistedWhileHeld.delivered_at).toBeNull();

    holdRequestRelease?.();
    await expect(firstResend).resolves.toBeUndefined();

    persistedWhileHeld = await readOutboxRow(outboxId);
    expect(capturedRequests).toHaveLength(1);
    expect(persistedWhileHeld.status).toBe(WebhookOutboxStatus.DELIVERED);
    expect(persistedWhileHeld.attempts).toBe(2);
    expect(persistedWhileHeld.delivered_at).not.toBeNull();
  });
});
