import path from 'node:path';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import {
  ClientWebhookEventPayload,
  ClientWebhookEventType,
} from '../src/client-webhook-outbox/client-webhook-event';
import { ClientWebhookNotifyService } from '../src/client-webhook-outbox/client-webhook-notify.service';
import { ClientWebhookOutboxStatus } from '../src/client-webhook-outbox/entity/client-webhook-outbox.entity';

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
  event_type: ClientWebhookEventType;
  endpoint_url: string;
  payload: ClientWebhookEventPayload;
  status: ClientWebhookOutboxStatus;
  attempts: number;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
};

const DEFAULT_TIMEOUT_MS = '150';

describe('ClientWebhookNotifyService (integration)', () => {
  let app: NestExpressApplication | null = null;
  let localServer: Server;
  let localServerUrl = '';
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
    payload: ClientWebhookEventPayload;
    status?: ClientWebhookOutboxStatus;
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
        params.status ?? ClientWebhookOutboxStatus.PENDING,
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
    eventType: ClientWebhookEventType;
    status?: 'awaiting_user' | 'approved';
    currentStep?: string | null;
    completedAt?: string | null;
  }): ClientWebhookEventPayload => ({
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

  const notifyService = (): ClientWebhookNotifyService => getApp().get(ClientWebhookNotifyService);

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
    process.env.CLIENT_WEBHOOK_URL = `${localServerUrl}/configured-at-test-bootstrap`;
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

    await app.init();
  });

  afterEach(async () => {
    capturedRequests.length = 0;

    if (app && createdOutboxIds.size > 0) {
      await dataSource().query('DELETE FROM client_webhook_outbox WHERE id = ANY($1::uuid[])', [
        Array.from(createdOutboxIds),
      ]);
      createdOutboxIds.clear();
    }

    if (app && createdOnboardingIds.size > 0) {
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

  it('sends exact persisted metadata snapshot on 2xx and marks delivered with one durable attempt', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003201';
    const outboxId = '00000000-0000-4000-8000-000000003211';
    const payload = buildPayload({
      eventId: '00000000-0000-4000-8000-000000003221',
      onboardingId,
      eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
    });

    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload,
    });

    const persistedBeforeNotify = await readOutboxRow(outboxId);

    await notifyService().notify(outboxId);

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].method).toBe('POST');
    expect(capturedRequests[0].path).toBe('/success');
    expect(capturedRequests[0].headers['content-type']).toContain('application/json');
    expect(capturedRequests[0].body).toEqual(persistedBeforeNotify.payload);

    const persistedAfterNotify = await readOutboxRow(outboxId);
    expect(persistedAfterNotify.endpoint_url).toBe(`${localServerUrl}/success`);
    expect(persistedAfterNotify.payload).toEqual(persistedBeforeNotify.payload);
    expect(persistedAfterNotify.status).toBe(ClientWebhookOutboxStatus.DELIVERED);
    expect(persistedAfterNotify.attempts).toBe(1);
    expect(persistedAfterNotify.delivered_at).not.toBeNull();
  });

  it('rejects on non-2xx and keeps pending with one attempt without storing response/error bodies', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003202';
    const outboxId = '00000000-0000-4000-8000-000000003212';
    const payload = buildPayload({
      eventId: '00000000-0000-4000-8000-000000003222',
      onboardingId,
      eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      currentStep: 'accept_terms',
    });

    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/non-2xx`,
      payload,
    });

    await expect(notifyService().notify(outboxId)).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
        message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      },
      status: 500,
    });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0].path).toBe('/non-2xx');

    const persisted = await readOutboxRow(outboxId);
    expect(persisted.status).toBe(ClientWebhookOutboxStatus.PENDING);
    expect(persisted.attempts).toBe(1);
    expect(persisted.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(persisted);
  });

  it('rejects on connection failure and timeout, keeping pending with one attempt per invocation', async () => {
    const connectionOnboardingId = '00000000-0000-4000-8000-000000003203';
    const connectionOutboxId = '00000000-0000-4000-8000-000000003213';
    const timeoutOnboardingId = '00000000-0000-4000-8000-000000003204';
    const timeoutOutboxId = '00000000-0000-4000-8000-000000003214';

    await createOnboardingFixture(connectionOnboardingId);
    await createOutboxFixture({
      id: connectionOutboxId,
      onboardingId: connectionOnboardingId,
      endpointUrl: 'http://127.0.0.1:65535/connection-failure',
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003223',
        onboardingId: connectionOnboardingId,
        eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
    });

    await createOnboardingFixture(timeoutOnboardingId);
    await createOutboxFixture({
      id: timeoutOutboxId,
      onboardingId: timeoutOnboardingId,
      endpointUrl: `${localServerUrl}/timeout`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003224',
        onboardingId: timeoutOnboardingId,
        eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
    });

    await expect(notifyService().notify(connectionOutboxId)).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
        message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      },
      status: 500,
    });
    await expect(notifyService().notify(timeoutOutboxId)).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
        message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      },
      status: 500,
    });

    expect(capturedRequests).toHaveLength(0);

    const connectionRow = await readOutboxRow(connectionOutboxId);
    expect(connectionRow.status).toBe(ClientWebhookOutboxStatus.PENDING);
    expect(connectionRow.attempts).toBe(1);
    expect(connectionRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(connectionRow);

    const timeoutRow = await readOutboxRow(timeoutOutboxId);
    expect(timeoutRow.status).toBe(ClientWebhookOutboxStatus.PENDING);
    expect(timeoutRow.attempts).toBe(1);
    expect(timeoutRow.delivered_at).toBeNull();
    assertNoResponseOrErrorBodyStored(timeoutRow);
  });

  it('does not resend delivered events and enforces unknown-id contract', async () => {
    const onboardingId = '00000000-0000-4000-8000-000000003205';
    const outboxId = '00000000-0000-4000-8000-000000003215';

    await createOnboardingFixture(onboardingId);
    await createOutboxFixture({
      id: outboxId,
      onboardingId,
      endpointUrl: `${localServerUrl}/success`,
      payload: buildPayload({
        eventId: '00000000-0000-4000-8000-000000003225',
        onboardingId,
        eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      }),
    });

    await notifyService().notify(outboxId);
    expect(capturedRequests).toHaveLength(1);

    capturedRequests.length = 0;

    await notifyService().notify(outboxId);

    expect(capturedRequests).toHaveLength(0);

    const rowAfterNoOp = await readOutboxRow(outboxId);
    expect(rowAfterNoOp.status).toBe(ClientWebhookOutboxStatus.DELIVERED);
    expect(rowAfterNoOp.attempts).toBe(1);

    await expect(
      notifyService().notify('00000000-0000-4000-8000-000000009999'),
    ).rejects.toMatchObject({
      response: {
        code: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
        message: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
      },
    });
  });
});
