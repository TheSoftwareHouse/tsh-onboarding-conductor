import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { HeadObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { validateConfig } from '../src/config/app.config';
import { ClientWebhookNotifyService } from '../src/client-webhook-outbox/client-webhook-notify.service';
import { ClientWebhookOutboxRepository } from '../src/client-webhook-outbox/client-webhook-outbox.repository';
import { OnboardingWebhookService } from '../src/onboardings/onboarding-webhook/onboarding-webhook.service';
import { TshKyc1Connector } from '../src/connectors/adapters/tsh-kyc.connector';
import { TshKyc2Connector } from '../src/connectors/adapters/tsh-kyc-2.connector';
import { WidenDocumentSizeColumns0004 } from '../src/database/migrations/0004_widen_document_size_columns';
import { OnboardingDocumentEntity } from '../src/onboardings/entity/onboarding-document.entity';
import { OnboardingsRepository } from '../src/onboardings/onboardings.repository';
import { OnboardingsService } from '../src/onboardings/onboardings.service';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';

const INVALID_STEP_DATA = {
  code: 'INVALID_STEP_DATA',
  message: 'INVALID_STEP_DATA',
};

let clientWebhookTestUrl = '';
let localWebhookResponseMode: 'success' | 'failure' = 'success';
const originalClientWebhookUrl = process.env.CLIENT_WEBHOOK_URL;

jest.setTimeout(30000);

describe('OnboardingsController (e2e)', () => {
  let app: NestExpressApplication | null = null;
  let localWebhookServer: Server | null = null;
  const createdOnboardingIds = new Set<string>();

  const readRawRequestBody = async (request: IncomingMessage): Promise<void> => {
    for await (const chunk of request) {
      void chunk;
      // Drain request body so client can finish request lifecycle cleanly.
    }
  };

  const startLocalWebhookServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      localWebhookServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        void readRawRequestBody(request).finally(() => {
          if (localWebhookResponseMode === 'failure') {
            response.statusCode = 503;
            response.end('client webhook unavailable');
            return;
          }

          response.statusCode = 204;
          response.end();
        });
      });

      localWebhookServer.once('error', reject);
      localWebhookServer.listen(0, '127.0.0.1', () => {
        const address = localWebhookServer?.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve local webhook server address'));
          return;
        }

        resolve(`http://127.0.0.1:${address.port}/client-webhook`);
      });
    });

  const closeLocalWebhookServer = async () => {
    if (!localWebhookServer?.listening) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      localWebhookServer?.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  };

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  beforeAll(async () => {
    clientWebhookTestUrl = await startLocalWebhookServer();

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
    process.env.CLIENT_WEBHOOK_URL = clientWebhookTestUrl;
    process.env.WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', 'workflows');

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

  const http = () => request(getApp().getHttpServer());

  const getSeededAdminOnboardingSummaries = (
    responseBody: Array<Record<string, unknown>>,
    seededIds: string[],
  ) =>
    responseBody.filter((item: Record<string, unknown>) =>
      seededIds.includes(item.onboardingId as string),
    );

  const expectSeededAdminOnboardingSummaries = (
    responseBody: Array<Record<string, unknown>>,
    seededIds: string[],
    expectedSummaries: Array<Record<string, unknown>>,
  ) => {
    const seededResponses = getSeededAdminOnboardingSummaries(responseBody, seededIds);

    expect(seededResponses).toEqual(expectedSummaries);
    expect(seededResponses.every((item: Record<string, unknown>) => !('context' in item))).toBe(
      true,
    );
  };

  const getAdminOnboardings = (query?: string | Record<string, string | string[]>) => {
    const requestBuilder = http().get('/v1/admin/onboardings');

    if (query === undefined) {
      return requestBuilder;
    }

    if (typeof query === 'string') {
      return http().get(`/v1/admin/onboardings${query}`);
    }

    return requestBuilder.query(query);
  };

  const snapshotExistingOnboardingIds = async (): Promise<string[]> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const existingRows = (await dataSource.query('SELECT id FROM onboardings')) as Array<{
      id: string;
    }>;

    return existingRows.map(({ id }) => id).sort();
  };

  const createUniqueOnboardingId = async (): Promise<string> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const existingRows = (await dataSource.query('SELECT id FROM onboardings')) as Array<{
      id: string;
    }>;
    const existingIds = new Set<string>(existingRows.map(({ id }) => id));

    const MAX_CANDIDATE_INDEX = 9999;

    for (let candidateIndex = 1; candidateIndex <= MAX_CANDIDATE_INDEX; candidateIndex += 1) {
      const candidateId = `00000000-0000-4000-8000-${String(candidateIndex).padStart(12, '0')}`;
      if (!existingIds.has(candidateId) && !createdOnboardingIds.has(candidateId)) {
        return candidateId;
      }
    }

    throw new Error('Unable to generate a unique onboarding test id: candidate space exhausted');
  };

  const seedAdminOnboardingsFixtures = async (
    fixtures: Array<{
      id?: string;
      workflowId: string;
      workflowVersion: number;
      status: 'awaiting_user' | 'awaiting_manual_review' | 'approved' | 'rejected';
      currentStep: string | null;
      context: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
      expiresAt: string | null;
    }>,
  ): Promise<string[]> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const seededIds: string[] = [];

    for (const fixture of fixtures) {
      const onboardingId = fixture.id ?? (await createUniqueOnboardingId());
      await dataSource.query(
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
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          onboardingId,
          fixture.workflowId,
          fixture.workflowVersion,
          fixture.status,
          fixture.currentStep,
          JSON.stringify(fixture.context),
          fixture.expiresAt,
          fixture.createdAt,
          fixture.updatedAt,
          fixture.completedAt,
        ],
      );
      createdOnboardingIds.add(onboardingId);
      seededIds.push(onboardingId);
    }

    return seededIds;
  };

  const cleanupAdminOnboardingsFixtures = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    await getApp()
      .get(DataSource)
      .query('DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])', [ids]);

    await getApp()
      .get(DataSource)
      .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [ids]);

    ids.forEach((id) => createdOnboardingIds.delete(id));
  };

  const storageClient = () =>
    new S3Client({
      region: 'us-east-1',
      endpoint: process.env.STORAGE_S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.STORAGE_S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.STORAGE_S3_SECRET_ACCESS_KEY ?? '',
      },
    });

  const createPngBytes = (color: readonly [number, number, number, number]) => {
    const [red, green, blue, alpha] = color;

    return Buffer.from([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x06,
      0x00,
      0x00,
      0x00,
      0x1f,
      0x15,
      0xc4,
      0x89,
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x44,
      0x41,
      0x54,
      0x78,
      0x9c,
      0x63,
      red,
      green,
      blue,
      alpha,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x7f,
      0x5d,
      0x1f,
      0x93,
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44,
      0xae,
      0x42,
      0x60,
      0x82,
    ]);
  };

  const uploadToStorage = async (
    ticket: { url: string; fields: Record<string, string> },
    fileName: string,
    bytes: Buffer,
  ) => {
    const form = new FormData();

    for (const [fieldName, fieldValue] of Object.entries(ticket.fields)) {
      form.append(fieldName, fieldValue);
    }

    form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/png' }), fileName);

    const response = await fetch(ticket.url, {
      method: 'POST',
      body: form,
    });

    expect(response.ok).toBe(true);
  };

  const readStorageObject = async (objectKey: string) => {
    const client = storageClient();
    const response = await client.send(
      new GetObjectCommand({
        Bucket: process.env.STORAGE_S3_BUCKET,
        Key: objectKey,
      }),
    );
    const body = response.Body as
      NodeJS.ReadableStream | Buffer | Uint8Array | ArrayBuffer | undefined;

    if (!body) {
      throw new Error(`expected storage object ${objectKey} to exist`);
    }

    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (body instanceof ArrayBuffer) {
      return Buffer.from(body);
    }

    const chunks: Buffer[] = [];
    for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
  };

  const expectStorageObjectMissing = async (objectKey: string) => {
    await expect(
      storageClient().send(
        new HeadObjectCommand({
          Bucket: process.env.STORAGE_S3_BUCKET,
          Key: objectKey,
        }),
      ),
    ).rejects.toThrow();
  };

  const startOnboarding = async () => {
    const response = await http().post('/v1/onboardings').send({ workflowId: 'base' }).expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'collect_email',
      expiresAt: null,
    });

    expect(response.body.onboardingId).not.toHaveLength(0);

    expect(await readOnboarding(response.body.onboardingId)).toEqual(
      expect.objectContaining({
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
        completed_at: null,
      }),
    );

    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);
    return onboardingId;
  };

  const startManualReviewOnboarding = async () => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'manual-review' })
      .expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_manual_review',
      currentStep: 'awaiting_manual_review',
      expiresAt: null,
    });

    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);
    return onboardingId;
  };

  const startOnboardingExpectingWebhookFailure = async () => {
    const response = await http().post('/v1/onboardings').send({ workflowId: 'base' }).expect(500);

    expect(response.body).toEqual({
      code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
    });
  };

  const readOnboarding = async (id: string) => {
    const rows = await getApp()
      .get(DataSource)
      .query(
        `SELECT workflow_id, workflow_version, status, current_step, context, completed_at
       FROM onboardings
       WHERE id = $1`,
        [id],
      );

    return rows[0];
  };

  const readOutboxRowsForOnboarding = async (onboardingId: string) => {
    const rows = await getApp()
      .get(DataSource)
      .query(
        `SELECT id, onboarding_id, event_type, endpoint_url, status, attempts, delivered_at, payload
         FROM client_webhook_outbox
         WHERE onboarding_id = $1
         ORDER BY created_at ASC, id ASC`,
        [onboardingId],
      );

    return rows as Array<{
      id: string;
      onboarding_id: string;
      event_type: 'onboarding.created' | 'onboarding.state_changed';
      endpoint_url: string;
      status: 'PENDING' | 'DELIVERED';
      attempts: number;
      delivered_at: string | null;
      payload: {
        version: 1;
        event: { id: string; type: string; occurredAt: string };
        onboarding: {
          id: string;
          workflowId: string;
          workflowVersion: number;
          status: 'awaiting_user' | 'approved';
          currentStep: string | null;
          completedAt: string | null;
        };
      };
    }>;
  };

  const countOutboxRows = async () => {
    const rows = await getApp()
      .get(DataSource)
      .query('SELECT COUNT(*)::int AS count FROM client_webhook_outbox');

    return (rows[0]?.count ?? 0) as number;
  };

  const assertMetadataOnlyPayloadShape = (payload: Record<string, unknown>) => {
    expect(Object.keys(payload).sort()).toEqual(['event', 'onboarding', 'version']);
    expect(payload).not.toHaveProperty('context');
    expect(payload).not.toHaveProperty('submittedData');
    expect(payload).not.toHaveProperty('connectorPayload');
    expect(payload).not.toHaveProperty('responseBody');
    expect(payload).not.toHaveProperty('errorBody');
  };

  const createIsolatedAppWithWebhookUrl = async (
    clientWebhookUrl: string | undefined,
  ): Promise<{ app: NestExpressApplication; restoreEnv: () => void }> => {
    const previousWebhookUrl = process.env.CLIENT_WEBHOOK_URL;
    if (clientWebhookUrl === undefined) {
      delete process.env.CLIENT_WEBHOOK_URL;
    } else {
      process.env.CLIENT_WEBHOOK_URL = clientWebhookUrl;
    }

    const restoreEnv = () => {
      if (previousWebhookUrl === undefined) {
        delete process.env.CLIENT_WEBHOOK_URL;
      } else {
        process.env.CLIENT_WEBHOOK_URL = previousWebhookUrl;
      }
    };

    // The AppModule import is cached by the runtime, so its ConfigModule
    // configuration (validated when the module was first loaded) is reused.
    // Build a fresh validated config from the current environment and override
    // ConfigService so the isolated app is not polluted by the cached value.
    const isolatedConfig = validateConfig({ ...process.env });

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue({
        get: <T = unknown>(key: string): T | undefined =>
          isolatedConfig[key as keyof typeof isolatedConfig] as T | undefined,
        getOrThrow: <T = unknown>(key: string): T => {
          const value = isolatedConfig[key as keyof typeof isolatedConfig];
          if (value === undefined) {
            throw new Error(`Configuration key "${key}" is not defined`);
          }
          return value as T;
        },
      })
      .compile();

    const isolatedApp = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    isolatedApp.useBodyParser('json', { strict: false });
    isolatedApp.useBodyParser('urlencoded', { extended: true });
    isolatedApp.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await isolatedApp.init();

    return { app: isolatedApp, restoreEnv };
  };

  const expectSemanticFailureAndUnchangedContext = async (
    id: string,
    body: Record<string, unknown>,
    expectedContext: Record<string, unknown>,
  ) => {
    const response = await http().post(`/v1/onboardings/${id}/submit`).send(body).expect(400);

    expect(response.body).toEqual(INVALID_STEP_DATA);
    expect(response.body).not.toHaveProperty('details');

    expect(await readOnboarding(id)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        context: expectedContext,
      }),
    );
  };

  const reserveAndCompleteFileDocument = async (onboardingId: string) => {
    const reservation = await http()
      .post(`/v1/onboardings/${onboardingId}/documents`)
      .send({ field: 'identityDocument', contentType: 'image/png', sizeBytes: 69 })
      .expect(201);

    const documentId = reservation.body.documentId as string;
    const firstUpload = createPngBytes([0x11, 0x22, 0x33, 0xff]);
    await uploadToStorage(reservation.body.upload, 'identity-document.png', firstUpload);

    await http()
      .post(`/v1/onboardings/${onboardingId}/documents/${documentId}/complete`)
      .send({})
      .expect((response) => expect([200, 201]).toContain(response.status));

    return documentId;
  };

  afterAll(async () => {
    if (app && createdOnboardingIds.size > 0) {
      await app
        .get(DataSource)
        .query('DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
      await app
        .get(DataSource)
        .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
    }

    if (app) {
      await app.close();
    }

    await closeLocalWebhookServer();

    if (originalClientWebhookUrl === undefined) {
      delete process.env.CLIENT_WEBHOOK_URL;
    } else {
      process.env.CLIENT_WEBHOOK_URL = originalClientWebhookUrl;
    }
  });

  it('starts a base onboarding in the first awaiting-user step', async () => {
    await startOnboarding();
  });

  it('persists one delivered onboarding.created outbox snapshot on successful onboarding creation', async () => {
    const onboardingId = await startOnboarding();
    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.created',
        status: 'DELIVERED',
        attempts: 1,
        endpoint_url: clientWebhookTestUrl,
      }),
    );
    expect(outboxRows[0].delivered_at).not.toBeNull();
    expect(outboxRows[0].payload.version).toBe(1);
    expect(outboxRows[0].payload.event.type).toBe('onboarding.created');
    expect(outboxRows[0].payload.onboarding).toEqual({
      id: onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_email',
      completedAt: null,
    });
    assertMetadataOnlyPayloadShape(outboxRows[0].payload as Record<string, unknown>);
  });

  it('commits onboarding creation and leaves a pending outbox row when webhook delivery fails', async () => {
    const previousWebhookResponseMode = localWebhookResponseMode;
    localWebhookResponseMode = 'failure';

    try {
      const onboardingIdsBefore = await snapshotExistingOnboardingIds();
      await startOnboardingExpectingWebhookFailure();

      const onboardingIdsAfter = await snapshotExistingOnboardingIds();
      const createdOnboardingId = onboardingIdsAfter.find(
        (onboardingId) => !onboardingIdsBefore.includes(onboardingId),
      );

      expect(createdOnboardingId).toBeDefined();
      if (!createdOnboardingId) {
        throw new Error('Unable to determine created onboarding id after webhook failure');
      }

      createdOnboardingIds.add(createdOnboardingId);

      const onboardingRows = (await getApp()
        .get(DataSource)
        .query(
          `SELECT workflow_id, workflow_version, status, current_step, context, completed_at
           FROM onboardings
           WHERE id = $1`,
          [createdOnboardingId],
        )) as Array<{
        workflow_id: string;
        workflow_version: number;
        status: 'awaiting_user' | 'approved';
        current_step: string | null;
        context: Record<string, unknown>;
        completed_at: string | null;
      }>;

      expect(onboardingRows).toHaveLength(1);
      expect(onboardingRows[0]).toEqual(
        expect.objectContaining({
          workflow_id: 'base',
          workflow_version: 1,
          status: 'awaiting_user',
          current_step: 'collect_email',
          context: {},
          completed_at: null,
        }),
      );

      const outboxRows = (await getApp()
        .get(DataSource)
        .query(
          `SELECT status, attempts, delivered_at
           FROM client_webhook_outbox
           WHERE onboarding_id = $1`,
          [createdOnboardingId],
        )) as Array<{
        status: string;
        attempts: number;
        delivered_at: string | null;
      }>;

      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toEqual(
        expect.objectContaining({
          status: 'PENDING',
          attempts: 1,
          delivered_at: null,
        }),
      );
    } finally {
      localWebhookResponseMode = previousWebhookResponseMode;
    }
  });

  it('persists outbox snapshots for successful non-terminal and terminal submit transitions', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(3);
    expect(outboxRows.map((row) => row.event_type)).toEqual([
      'onboarding.created',
      'onboarding.state_changed',
      'onboarding.state_changed',
    ]);
    expect(outboxRows.every((row) => row.status === 'DELIVERED')).toBe(true);
    expect(outboxRows.every((row) => row.attempts === 1)).toBe(true);
    expect(outboxRows.every((row) => row.delivered_at !== null)).toBe(true);
    expect(outboxRows.every((row) => row.endpoint_url === clientWebhookTestUrl)).toBe(true);

    const nonTerminalPayload = outboxRows[1].payload;
    expect(nonTerminalPayload.event.type).toBe('onboarding.state_changed');
    expect(nonTerminalPayload.onboarding).toEqual({
      id: onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      completedAt: null,
    });
    assertMetadataOnlyPayloadShape(nonTerminalPayload as Record<string, unknown>);

    const terminalPayload = outboxRows[2].payload;
    expect(terminalPayload.event.type).toBe('onboarding.state_changed');
    expect(terminalPayload.onboarding.id).toBe(onboardingId);
    expect(terminalPayload.onboarding.workflowId).toBe('base');
    expect(terminalPayload.onboarding.workflowVersion).toBe(1);
    expect(terminalPayload.onboarding.status).toBe('approved');
    expect(terminalPayload.onboarding.currentStep).toBeNull();
    expect(terminalPayload.onboarding.completedAt).not.toBeNull();
    assertMetadataOnlyPayloadShape(terminalPayload as Record<string, unknown>);
  });

  it('keeps onboarding and outbox unchanged for invalid submit payloads', async () => {
    const onboardingId = await startOnboarding();
    const outboxCountBefore = await countOutboxRows();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'not-an-email' })
      .expect(400)
      .expect(INVALID_STEP_DATA);

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );
    expect(await countOutboxRows()).toBe(outboxCountBefore);
    expect(await readOutboxRowsForOnboarding(onboardingId)).toHaveLength(1);
  });

  it('rolls back onboarding creation when outbox persistence fails and leaves no orphan event', async () => {
    const outboxRepository = getApp().get(ClientWebhookOutboxRepository);
    const createPendingSpy = jest
      .spyOn(outboxRepository, 'createPending')
      .mockRejectedValueOnce(new Error('forced outbox persistence failure'));
    try {
      const dataSource = getApp().get(DataSource) as DataSource;
      const onboardingCountBeforeRows = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM onboardings',
      );
      const outboxCountBeforeRows = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM client_webhook_outbox',
      );
      const onboardingCountBefore = onboardingCountBeforeRows[0].count as number;
      const outboxCountBefore = outboxCountBeforeRows[0].count as number;

      await http().post('/v1/onboardings').send({ workflowId: 'base' }).expect(500);

      const onboardingCountAfterRows = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM onboardings',
      );
      const outboxCountAfterRows = await dataSource.query(
        'SELECT COUNT(*)::int AS count FROM client_webhook_outbox',
      );
      expect(onboardingCountAfterRows[0].count as number).toBe(onboardingCountBefore);
      expect(outboxCountAfterRows[0].count as number).toBe(outboxCountBefore);
    } finally {
      createPendingSpy.mockRestore();
    }
  });

  it('creates no outbox rows when webhook endpoint is disabled and preserves onboarding behavior', async () => {
    const { app: disabledApp, restoreEnv } = await createIsolatedAppWithWebhookUrl(undefined);
    const disabledHttp = () => request(disabledApp.getHttpServer());
    const disabledDataSource = disabledApp.get(DataSource) as DataSource;
    let onboardingId: string | null = null;

    try {
      const startResponse = await disabledHttp()
        .post('/v1/onboardings')
        .send({ workflowId: 'base' })
        .expect(201);
      onboardingId = startResponse.body.onboardingId as string;

      expect(startResponse.body).toEqual({
        onboardingId: expect.any(String),
        status: 'awaiting_user',
        currentStep: 'collect_email',
        expiresAt: null,
      });

      await disabledHttp()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'disabled@example.com' })
        .expect((response) => expect([200, 201]).toContain(response.status))
        .expect({
          appliedStep: 'collect_email',
          status: 'awaiting_user',
          currentStep: 'accept_terms',
        });

      const outboxRows = await disabledDataSource.query(
        `SELECT id
         FROM client_webhook_outbox
         WHERE onboarding_id = $1`,
        [onboardingId],
      );
      expect(outboxRows).toHaveLength(0);

      const onboardingRows = await disabledDataSource.query(
        `SELECT workflow_id, workflow_version, status, current_step, context, completed_at
         FROM onboardings
         WHERE id = $1`,
        [onboardingId],
      );
      expect(onboardingRows).toHaveLength(1);
      expect(onboardingRows[0]).toEqual(
        expect.objectContaining({
          workflow_id: 'base',
          workflow_version: 1,
          status: 'awaiting_user',
          current_step: 'accept_terms',
          context: { email: 'disabled@example.com' },
          completed_at: null,
        }),
      );
    } finally {
      if (onboardingId) {
        await disabledDataSource.query(
          'DELETE FROM client_webhook_outbox WHERE onboarding_id = $1',
          [onboardingId],
        );
        await disabledDataSource.query('DELETE FROM onboardings WHERE id = $1', [onboardingId]);
      }
      await disabledApp.close();
      restoreEnv();
    }
  });

  it('lists seeded admin onboarding summaries for an unfiltered request with deterministic ordering', async () => {
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 11,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-a', email: 'alpha@example.com' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 12,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-b', email: 'beta@example.com' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-01-01T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 13,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-c', email: 'gamma@example.com' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings().expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[2],
          workflowId: 'workflow-gamma',
          workflowVersion: 13,
          status: 'awaiting_user',
          currentStep: 'review_profile',
          expiresAt: null,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          completedAt: null,
        },
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 12,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: '2024-01-01T00:01:00.000Z',
        },
        {
          onboardingId: seededIds[0],
          workflowId: 'workflow-alpha',
          workflowVersion: 11,
          status: 'awaiting_user',
          currentStep: 'collect_email',
          expiresAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact workflow version', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 21,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-version-1' },
        createdAt: '2024-02-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 22,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-version-2' },
        createdAt: '2024-02-02T00:00:00.000Z',
        updatedAt: '2024-02-02T00:00:00.000Z',
        completedAt: '2024-02-02T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 23,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-version-3' },
        createdAt: '2024-02-03T00:00:00.000Z',
        updatedAt: '2024-02-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings('?workflowVersion=22').expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 22,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-02-02T00:00:00.000Z',
          updatedAt: '2024-02-02T00:00:00.000Z',
          completedAt: '2024-02-02T00:01:00.000Z',
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact current step', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 31,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-step-1' },
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 32,
        status: 'awaiting_user' as const,
        currentStep: 'accept_terms',
        context: { source: 'seed-step-2' },
        createdAt: '2024-03-02T00:00:00.000Z',
        updatedAt: '2024-03-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 33,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-step-3' },
        createdAt: '2024-03-03T00:00:00.000Z',
        updatedAt: '2024-03-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings('?currentStep=accept_terms').expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 32,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
          expiresAt: null,
          createdAt: '2024-03-02T00:00:00.000Z',
          updatedAt: '2024-03-02T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact onboarding id', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 41,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-id-1' },
        createdAt: '2024-04-01T00:00:00.000Z',
        updatedAt: '2024-04-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 42,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-id-2' },
        createdAt: '2024-04-02T00:00:00.000Z',
        updatedAt: '2024-04-02T00:00:00.000Z',
        completedAt: '2024-04-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings(`?onboardingId=${seededIds[1]}`).expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 42,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-04-02T00:00:00.000Z',
          updatedAt: '2024-04-02T00:00:00.000Z',
          completedAt: '2024-04-02T00:01:00.000Z',
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('combines status and workflow version filters and workflow id with current step filters using AND semantics', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 51,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-and-1' },
        createdAt: '2024-05-01T00:00:00.000Z',
        updatedAt: '2024-05-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 52,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-and-2' },
        createdAt: '2024-05-02T00:00:00.000Z',
        updatedAt: '2024-05-02T00:00:00.000Z',
        completedAt: '2024-05-02T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 53,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-and-3' },
        createdAt: '2024-05-03T00:00:00.000Z',
        updatedAt: '2024-05-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const statusAndVersionResponse = await getAdminOnboardings(
        '?status=approved&workflowVersion=52',
      ).expect(200);
      expectSeededAdminOnboardingSummaries(statusAndVersionResponse.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 52,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-05-02T00:00:00.000Z',
          updatedAt: '2024-05-02T00:00:00.000Z',
          completedAt: '2024-05-02T00:01:00.000Z',
        },
      ]);

      const workflowAndStepResponse = await getAdminOnboardings(
        '?workflowId=workflow-beta&currentStep=review_profile',
      ).expect(200);
      expectSeededAdminOnboardingSummaries(workflowAndStepResponse.body, seededIds, [
        {
          onboardingId: seededIds[2],
          workflowId: 'workflow-beta',
          workflowVersion: 53,
          status: 'awaiting_user',
          currentStep: 'review_profile',
          expiresAt: null,
          createdAt: '2024-05-03T00:00:00.000Z',
          updatedAt: '2024-05-03T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('returns an empty list for a valid no-match filter combination', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 61,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-no-match-1' },
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 62,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-no-match-2' },
        createdAt: '2024-06-02T00:00:00.000Z',
        updatedAt: '2024-06-02T00:00:00.000Z',
        completedAt: '2024-06-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings(
        '?status=approved&workflowId=does-not-exist&workflowVersion=999&currentStep=missing-step&onboardingId=ffffffff-ffff-4fff-8fff-ffffffffffff',
      ).expect(200);

      expect(response.body).toEqual([]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact status', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-status-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-status-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: '2024-01-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await http().get('/v1/admin/onboardings?status=awaiting_user').expect(200);
      const seededResponses = response.body.filter((item: Record<string, unknown>) =>
        seededIds.includes(item.onboardingId as string),
      );

      expect(seededResponses).toHaveLength(1);
      expect(seededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[0],
          status: 'awaiting_user',
          workflowId: 'workflow-a',
        }),
      );
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact workflow id', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-workflow-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-workflow-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await http().get('/v1/admin/onboardings?workflowId=workflow-b').expect(200);
      const seededResponses = response.body.filter((item: Record<string, unknown>) =>
        seededIds.includes(item.onboardingId as string),
      );

      expect(seededResponses).toHaveLength(1);
      expect(seededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[1],
          workflowId: 'workflow-b',
        }),
      );
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('composes status and workflow id filters with AND semantics and returns an empty list for no matches', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-combined-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-combined-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-combined-3' },
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
        completedAt: '2024-01-03T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const combinedResponse = await http()
        .get('/v1/admin/onboardings?status=awaiting_user&workflowId=workflow-b')
        .expect(200);
      const combinedSeededResponses = combinedResponse.body.filter(
        (item: Record<string, unknown>) => seededIds.includes(item.onboardingId as string),
      );

      expect(combinedSeededResponses).toHaveLength(1);
      expect(combinedSeededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[1],
          workflowId: 'workflow-b',
          status: 'awaiting_user',
        }),
      );

      const noMatchResponse = await http()
        .get('/v1/admin/onboardings?status=approved&workflowId=does-not-exist')
        .expect(200);
      expect(noMatchResponse.body).toEqual([]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it.each([
    ['invalid status', '?status=invalid'],
    ['blank workflow id', '?workflowId='],
    ['whitespace-only workflow id', '?workflowId=%20%20%20'],
    ['oversized workflow id', `?workflowId=${'x'.repeat(101)}`],
  ])('rejects %s through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it.each([
    ['zero', '?workflowVersion=0'],
    ['negative', '?workflowVersion=-1'],
    ['decimal', '?workflowVersion=1.5'],
    ['non-numeric', '?workflowVersion=abc'],
    ['blank', '?workflowVersion='],
    ['non-finite', '?workflowVersion=Infinity'],
    ['repeated', '?workflowVersion=1&workflowVersion=2'],
  ])('rejects %s workflowVersion through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array workflowVersion values through global validation', async () => {
    await getAdminOnboardings({ workflowVersion: ['1', '2'] }).expect(400);
  });

  it.each([
    ['blank', '?currentStep='],
    ['whitespace-only', '?currentStep=%20%20%20'],
    ['oversized', `?currentStep=${'x'.repeat(101)}`],
    ['repeated', '?currentStep=collect_email&currentStep=accept_terms'],
  ])('rejects %s currentStep through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array currentStep values through global validation', async () => {
    await getAdminOnboardings({ currentStep: ['collect_email', 'accept_terms'] }).expect(400);
  });

  it.each([
    ['malformed', '?onboardingId=not-a-uuid'],
    ['blank', '?onboardingId='],
    [
      'repeated',
      '?onboardingId=00000000-0000-4000-8000-000000000011&onboardingId=00000000-0000-4000-8000-000000000012',
    ],
  ])('rejects %s onboardingId through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array onboardingId values through global validation', async () => {
    await getAdminOnboardings({
      onboardingId: [
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000012',
      ],
    }).expect(400);
  });

  it.each([{}, { workflowId: '' }])('rejects a missing or blank workflow id', async (body) => {
    await http().post('/v1/onboardings').send(body).expect(400);
  });

  it('does not accept flowId as an initialization alias', async () => {
    await http().post('/v1/onboardings').send({ flowId: 'base' }).expect(400);
  });

  it('rejects an unknown flow with a stable not-found response', async () => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'unknown' })
      .expect(404);

    expect(response.body).toEqual({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
  });

  it('returns different ids for two valid starts', async () => {
    const first = await startOnboarding();
    const second = await startOnboarding();

    expect(first).not.toBe(second);
  });

  it('progresses through both canonical HTTP submits and protects the completed state', async () => {
    const onboardingId = await startOnboarding();
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    expect(firstConnector.type).toBe('mock_kyc_1');
    expect(secondConnector.type).toBe('mock_kyc_2');
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_email',
        status: 'awaiting_user',
        currentStep: 'accept_terms',
      });

    expect(firstVerifySpy).toHaveBeenCalledWith({
      execution: { onboardingId, stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(firstVerifySpy).toHaveBeenCalledTimes(1);
    expect(secondVerifySpy).not.toHaveBeenCalled();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({ appliedStep: 'accept_terms', status: 'approved', currentStep: null });

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.completed_at).not.toBeNull();
    expect(completed.context).toEqual({ email: 'person@example.com', acceptedTerms: true });

    expect(secondVerifySpy).toHaveBeenCalledWith({
      execution: { onboardingId, stepName: 'accept_terms' },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: {
        email: 'email',
        acceptedTerms: 'acceptedTerms',
      },
    });
    expect(secondVerifySpy).toHaveBeenCalledTimes(1);
    expect(firstVerifySpy).toHaveBeenNthCalledWith(2, {
      execution: { onboardingId, stepName: 'accept_terms' },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(firstVerifySpy).toHaveBeenCalledTimes(2);

    const firstConnectorSecondCallOrder = firstVerifySpy.mock.invocationCallOrder[1];
    const secondConnectorFirstCallOrder = secondVerifySpy.mock.invocationCallOrder[0];
    expect(firstConnectorSecondCallOrder).toBeDefined();
    expect(secondConnectorFirstCallOrder).toBeDefined();
    expect(firstConnectorSecondCallOrder).toBeLessThan(secondConnectorFirstCallOrder);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    expect(await readOnboarding(onboardingId)).toEqual(completed);
    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('does not invoke the connector or mutate state for invalid submit input', async () => {
    const onboardingId = await startOnboarding();
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'not-an-email' })
      .expect(400)
      .expect(INVALID_STEP_DATA);

    expect(firstVerifySpy).not.toHaveBeenCalled();
    expect(secondVerifySpy).not.toHaveBeenCalled();
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('applies approve, reject, and return review actions with exact lifecycle projections', async () => {
    const approveOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${approveOnboardingId}/review/approve`)
      .expect(200)
      .expect({ appliedStep: 'awaiting_manual_review', status: 'approved', currentStep: null });
    expect(await readOnboarding(approveOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'approved',
        current_step: null,
        completed_at: expect.anything(),
        context: {},
      }),
    );

    const rejectOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${rejectOnboardingId}/review/reject`)
      .expect(200)
      .expect({ appliedStep: 'awaiting_manual_review', status: 'rejected', currentStep: null });
    expect(await readOnboarding(rejectOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'rejected',
        current_step: null,
        completed_at: expect.anything(),
        context: {},
      }),
    );

    const returnOnboardingId = await startManualReviewOnboarding();
    await http().post(`/v1/onboardings/${returnOnboardingId}/review/return`).expect(200).expect({
      appliedStep: 'awaiting_manual_review',
      status: 'awaiting_user',
      currentStep: 'correction',
    });
    expect(await readOnboarding(returnOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'correction',
        completed_at: null,
        context: {},
      }),
    );
  });

  it('rejects invalid review actions and preserves valid review actions without a body payload', async () => {
    const invalidOnboardingId = await startManualReviewOnboarding();
    await http().post(`/v1/onboardings/${invalidOnboardingId}/review`).expect(404);
    await http().post(`/v1/onboardings/${invalidOnboardingId}/review/unsupported`).expect(400);
    await http()
      .post(`/v1/onboardings/${invalidOnboardingId}/review/approve`)
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(200);
    expect(await readOnboarding(invalidOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'approved',
        current_step: null,
        completed_at: expect.anything(),
        context: {},
      }),
    );

    const whitelistedOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${whitelistedOnboardingId}/review/approve`)
      .expect(200)
      .expect({ appliedStep: 'awaiting_manual_review', status: 'approved', currentStep: null });
    expect(await readOnboarding(whitelistedOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'approved',
        current_step: null,
        completed_at: expect.anything(),
        context: {},
      }),
    );
  });

  it('returns exact unavailable, unknown, and completed review conflict states without mutation', async () => {
    const unavailableOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${unavailableOnboardingId}/review/return`)
      .expect(200)
      .expect({
        appliedStep: 'awaiting_manual_review',
        status: 'awaiting_user',
        currentStep: 'correction',
      });
    const unavailableResponse = await http()
      .post(`/v1/onboardings/${unavailableOnboardingId}/review/approve`)
      .expect(409);
    expect(unavailableResponse.body).toEqual({
      code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
    });
    expect(await readOnboarding(unavailableOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'correction',
        completed_at: null,
        context: {},
      }),
    );

    await http()
      .post('/v1/onboardings/01900000-0000-7000-8000-000000000000/review/approve')
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });

    const completedApprovedOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${completedApprovedOnboardingId}/review/approve`)
      .expect(200);
    const approvedCompletedResponse = await http()
      .post(`/v1/onboardings/${completedApprovedOnboardingId}/review/reject`)
      .expect(409);
    expect(approvedCompletedResponse.body).toEqual({
      code: 'ONBOARDING_COMPLETED',
      message: 'ONBOARDING_COMPLETED',
    });
    expect(await readOnboarding(completedApprovedOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'approved',
        current_step: null,
        completed_at: expect.anything(),
      }),
    );

    const completedRejectedOnboardingId = await startManualReviewOnboarding();
    await http().post(`/v1/onboardings/${completedRejectedOnboardingId}/review/reject`).expect(200);
    const rejectedCompletedResponse = await http()
      .post(`/v1/onboardings/${completedRejectedOnboardingId}/review/approve`)
      .expect(409);
    expect(rejectedCompletedResponse.body).toEqual({
      code: 'ONBOARDING_COMPLETED',
      message: 'ONBOARDING_COMPLETED',
    });
    expect(await readOnboarding(completedRejectedOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'rejected',
        current_step: null,
        completed_at: expect.anything(),
      }),
    );
  });

  it('lists and filters admin onboarding summaries for awaiting_manual_review and rejected states', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-manual-review',
        workflowVersion: 71,
        status: 'awaiting_manual_review' as const,
        currentStep: 'awaiting_manual_review',
        context: { source: 'seed-manual-review-1' },
        createdAt: '2024-07-01T00:00:00.000Z',
        updatedAt: '2024-07-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-manual-review',
        workflowVersion: 72,
        status: 'rejected' as const,
        currentStep: null,
        context: { source: 'seed-manual-review-2' },
        createdAt: '2024-07-02T00:00:00.000Z',
        updatedAt: '2024-07-02T00:00:00.000Z',
        completedAt: '2024-07-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const manualReviewResponse = await getAdminOnboardings(
        '?status=awaiting_manual_review',
      ).expect(200);
      expectSeededAdminOnboardingSummaries(manualReviewResponse.body, seededIds, [
        {
          onboardingId: seededIds[0],
          workflowId: 'workflow-manual-review',
          workflowVersion: 71,
          status: 'awaiting_manual_review',
          currentStep: 'awaiting_manual_review',
          expiresAt: null,
          createdAt: '2024-07-01T00:00:00.000Z',
          updatedAt: '2024-07-01T00:00:00.000Z',
          completedAt: null,
        },
      ]);

      const rejectedResponse = await getAdminOnboardings('?status=rejected').expect(200);
      expectSeededAdminOnboardingSummaries(rejectedResponse.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-manual-review',
          workflowVersion: 72,
          status: 'rejected',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-07-02T00:00:00.000Z',
          updatedAt: '2024-07-02T00:00:00.000Z',
          completedAt: '2024-07-02T00:01:00.000Z',
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('exposes only the canonical generic submit route', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/steps/collect_email/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/onboardings/${onboardingId}/collect_email/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/onboardings/${onboardingId}/user-id/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/bff/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/public/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ stepId: 'collect_email', email: 'person@example.com' })
      .expect(400)
      .expect(INVALID_STEP_DATA);
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_email',
        context: {},
      }),
    );
  });

  it('uploads, completes, and submits a file-backed onboarding through the mock adapter storage seam without exposing storage identity', async () => {
    const reservationResponse = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'file-upload' })
      .expect(201);

    expect(reservationResponse.body).toEqual(
      expect.objectContaining({
        onboardingId: expect.any(String),
        status: 'awaiting_user',
        currentStep: 'collect_identity',
        expiresAt: null,
      }),
    );

    const onboardingId = reservationResponse.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    const reservation = await http()
      .post(`/v1/onboardings/${onboardingId}/documents`)
      .send({ field: 'identityDocument', contentType: 'image/png', sizeBytes: 69 })
      .expect(201);

    expect(reservation.body).toEqual({
      documentId: expect.any(String),
      upload: {
        kind: 'post-form',
        url: expect.any(String),
        fields: expect.objectContaining({
          key: expect.any(String),
        }),
      },
      expiresAt: expect.any(String),
    });
    expect(reservation.body.upload.url).toEqual(expect.any(String));
    expect(JSON.stringify(reservation.body.upload.fields)).not.toContain('Bearer');

    const documentId = reservation.body.documentId as string;
    const stagingObjectKey = `onboardings/${onboardingId}/${documentId}/staged`;
    const finalObjectKey = `onboardings/${onboardingId}/${documentId}/final`;
    const firstUpload = createPngBytes([0x11, 0x22, 0x33, 0xff]);
    const secondUpload = createPngBytes([0xaa, 0xbb, 0xcc, 0xff]);

    await uploadToStorage(reservation.body.upload, 'identity-document.png', firstUpload);

    const completion = await http()
      .post(`/v1/onboardings/${onboardingId}/documents/${documentId}/complete`)
      .send({})
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(completion.body).toEqual({ documentId });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_identity',
        context: {},
      }),
    );

    await expectStorageObjectMissing(stagingObjectKey);
    expect(await readStorageObject(finalObjectKey)).toEqual(firstUpload);

    await uploadToStorage(reservation.body.upload, 'identity-document-again.png', secondUpload);
    expect(await readStorageObject(finalObjectKey)).toEqual(firstUpload);

    const submitResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ identityDocument: documentId, documentLabel: 'identity-card' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(submitResponse.body).toEqual({
      appliedStep: 'collect_identity',
      status: 'approved',
      currentStep: null,
    });

    const completedOnboarding = await readOnboarding(onboardingId);
    expect(completedOnboarding).toEqual(
      expect.objectContaining({
        status: 'approved',
        current_step: null,
        completed_at: expect.anything(),
        context: {
          identityDocument: documentId,
          documentLabel: 'identity-card',
        },
      }),
    );

    const documentRows = await getApp()
      .get(DataSource)
      .query(
        `SELECT onboarding_id, step_name, field_name, status, staging_object_key, final_object_key, requested_content_type, requested_max_size_bytes, verified_content_type, verified_size_bytes, verified_etag, completed_at
       FROM onboarding_documents
       WHERE id = $1`,
        [documentId],
      );

    expect(documentRows).toHaveLength(1);
    expect(documentRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        step_name: 'collect_identity',
        field_name: 'identityDocument',
        status: 'completed',
        staging_object_key: `onboardings/${onboardingId}/${documentId}/staged`,
        final_object_key: `onboardings/${onboardingId}/${documentId}/final`,
        requested_content_type: 'image/png',
        requested_max_size_bytes: '69',
        verified_content_type: 'image/png',
        verified_size_bytes: '69',
        verified_etag: expect.any(String),
        completed_at: expect.anything(),
      }),
    );

    expect(JSON.stringify(completedOnboarding.context)).not.toContain('onboardings/');
    expect(JSON.stringify(completedOnboarding.context)).not.toContain('127.0.0.1:9000');
    expect(JSON.stringify(completedOnboarding.context)).not.toContain('identity-document.png');
  });

  it('rejects file-upload submissions with invalid ownership or incomplete references through the generic invalid-step response', async () => {
    const cases = [
      {
        label: 'incorrect onboarding ownership',
        mutate: async (documentId: string, foreignOnboardingId?: string) => {
          if (!foreignOnboardingId) {
            throw new Error('missing foreign onboarding id for ownership test case');
          }

          await getApp()
            .get(DataSource)
            .query(`UPDATE onboarding_documents SET onboarding_id = $1 WHERE id = $2`, [
              foreignOnboardingId,
              documentId,
            ]);
        },
      },
      {
        label: 'incomplete final reference',
        mutate: async (documentId: string) => {
          await getApp()
            .get(DataSource)
            .query(
              `UPDATE onboarding_documents SET final_object_key = NULL, verified_etag = NULL, verified_size_bytes = NULL WHERE id = $1`,
              [documentId],
            );
        },
      },
    ];

    for (const testCase of cases) {
      const startResponse = await http()
        .post('/v1/onboardings')
        .send({ workflowId: 'file-upload' })
        .expect(201);

      expect(startResponse.body).toEqual(
        expect.objectContaining({
          onboardingId: expect.any(String),
          status: 'awaiting_user',
          currentStep: 'collect_identity',
          expiresAt: null,
        }),
      );

      const onboardingId = startResponse.body.onboardingId as string;
      createdOnboardingIds.add(onboardingId);
      const documentId = await reserveAndCompleteFileDocument(onboardingId);

      let foreignOnboardingId: string | undefined;

      if (testCase.label === 'incorrect onboarding ownership') {
        const foreignStartResponse = await http()
          .post('/v1/onboardings')
          .send({ workflowId: 'file-upload' })
          .expect(201);

        foreignOnboardingId = foreignStartResponse.body.onboardingId as string;
        createdOnboardingIds.add(foreignOnboardingId);
      }

      await testCase.mutate(documentId, foreignOnboardingId);
      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ identityDocument: documentId, documentLabel: 'identity-card' })
        .expect(400);

      expect(response.body).toEqual(INVALID_STEP_DATA);
      expect(response.body).not.toHaveProperty('details');
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'collect_identity',
          context: {},
        }),
      );
    }
  });

  it('keeps the active step and context unchanged after each semantic failure', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const emptyEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(emptyEmail, {}, {});
    await http()
      .post(`/v1/onboardings/${emptyEmail}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const invalidEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(invalidEmail, { email: 'not-an-email' }, {});
    await http()
      .post(`/v1/onboardings/${invalidEmail}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const falseConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${falseConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      falseConsent,
      { acceptedTerms: false },
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${falseConsent}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const missingConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${missingConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      missingConsent,
      {},
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${missingConsent}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const inactiveField = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${inactiveField}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      inactiveField,
      { email: 'valid@example.com' },
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${inactiveField}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('returns the semantic error for wrong primitive types', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const emailType = await startOnboarding();
    const emailError = await http()
      .post(`/v1/onboardings/${emailType}/submit`)
      .send({ email: 123 })
      .expect(400);
    expect(emailError.body).toEqual(INVALID_STEP_DATA);
    expect(emailError.body).not.toHaveProperty('details');
    expect(await readOnboarding(emailType)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );
    await http()
      .post(`/v1/onboardings/${emailType}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const consentType = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    const consentError = await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ acceptedTerms: 'true' })
      .expect(400);
    expect(consentError.body).toEqual(INVALID_STEP_DATA);
    expect(consentError.body).not.toHaveProperty('details');
    expect(await readOnboarding(consentType)).toEqual(
      expect.objectContaining({
        context: { email: 'valid@example.com' },
        current_step: 'accept_terms',
      }),
    );
    await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a JSON string', JSON.stringify('person@example.com')],
    ['a JSON number', '123'],
    ['a JSON boolean', 'true'],
  ])('rejects %s submit bodies through the JSON transport', async (_label, body) => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400)
      .expect(INVALID_STEP_DATA);

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );
  });

  it('preserves configured dynamic keys and rejects undeclared data without mutation', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const onboardingId = await startOnboarding();

    const undeclaredResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com', unexpected: 'discard-me' })
      .expect(400);
    expect(undeclaredResponse.body).toEqual(INVALID_STEP_DATA);
    expect(undeclaredResponse.body).not.toHaveProperty('details');
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_email',
        context: {},
      }),
    );

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: { email: 'person@example.com', acceptedTerms: true },
        current_step: null,
        status: 'approved',
      }),
    );

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('rejects unknown onboarding ids with a stable body', async () => {
    await http()
      .post('/v1/onboardings/01900000-0000-7000-8000-000000000000/submit')
      .send({ email: 'person@example.com' })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
  });

  it('continues a persisted onboarding through a fresh service instance', async () => {
    const onboardingId = await startOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;
    const freshService = new OnboardingsService(
      dataSource,
      new OnboardingsRepository(),
      getApp().get(WorkflowRegistryService),
      getApp().get(OnboardingWebhookService),
      getApp().get(ClientWebhookNotifyService),
    );

    await expect(
      freshService.submit(onboardingId, { email: 'fresh@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'collect_email',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
    });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: { email: 'fresh@example.com' },
        current_step: 'accept_terms',
      }),
    );
  });

  it('proves the real Postgres row lock rejects a stale submit after release', async () => {
    const onboardingId = await startOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;
    const holder = dataSource.createQueryRunner();
    let staleSettled = false;

    try {
      await holder.connect();
      await holder.startTransaction();
      await holder.query('SELECT id FROM onboardings WHERE id = $1 FOR UPDATE', [onboardingId]);
      await holder.query(
        `UPDATE onboardings
         SET current_step = 'accept_terms', context = $2::jsonb, status = 'awaiting_user', completed_at = NULL
         WHERE id = $1`,
        [onboardingId, JSON.stringify({ email: 'holder@example.com' })],
      );

      const staleSubmit = http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'stale@example.com' })
        .then((response) => {
          staleSettled = true;
          return response;
        });

      const barrierDeadline = Date.now() + 5000;
      let lockWaitObserved = false;
      while (!lockWaitObserved && !staleSettled && Date.now() < barrierDeadline) {
        const waiting = await dataSource.query(
          `SELECT 1
           FROM pg_stat_activity
           WHERE wait_event_type = 'Lock'
             AND query ILIKE '%FOR UPDATE%'
             AND pid <> pg_backend_pid()
           LIMIT 1`,
        );
        lockWaitObserved = waiting.length === 1;
        if (!lockWaitObserved) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      expect(staleSettled).toBe(false);
      expect(lockWaitObserved).toBe(true);

      await holder.commitTransaction();
      await expect(staleSubmit).resolves.toMatchObject({
        status: 400,
        body: INVALID_STEP_DATA,
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'accept_terms',
          context: { email: 'holder@example.com' },
        }),
      );
    } finally {
      if (holder.isTransactionActive) {
        await holder.rollbackTransaction();
      }
      await holder.release();
    }
  });

  it('proves a stale manual review request returns ONBOARDING_COMPLETED after a winning review commits', async () => {
    const onboardingId = await startManualReviewOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;
    const holder = dataSource.createQueryRunner();
    let staleSettled = false;

    try {
      await holder.connect();
      await holder.startTransaction();
      await holder.query('SELECT id FROM onboardings WHERE id = $1 FOR UPDATE', [onboardingId]);

      const staleReview = http()
        .post(`/v1/onboardings/${onboardingId}/review/approve`)
        .then((response) => {
          staleSettled = true;
          return response;
        });

      const barrierDeadline = Date.now() + 5000;
      let lockWaitObserved = false;
      while (!lockWaitObserved && !staleSettled && Date.now() < barrierDeadline) {
        const waiting = await dataSource.query(
          `SELECT 1
           FROM pg_stat_activity
           WHERE wait_event_type = 'Lock'
             AND query ILIKE '%FOR UPDATE%'
             AND pid <> pg_backend_pid()
           LIMIT 1`,
        );
        lockWaitObserved = waiting.length === 1;
        if (!lockWaitObserved) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      expect(staleSettled).toBe(false);
      expect(lockWaitObserved).toBe(true);

      await holder.query(
        `UPDATE onboardings
         SET status = 'approved', current_step = NULL, completed_at = NOW(), context = $2::jsonb
         WHERE id = $1`,
        [onboardingId, JSON.stringify({})],
      );
      await holder.commitTransaction();

      await expect(staleReview).resolves.toMatchObject({
        status: 409,
        body: { code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' },
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'approved',
          current_step: null,
          completed_at: expect.anything(),
          context: {},
        }),
      );
    } finally {
      if (holder.isTransactionActive) {
        await holder.rollbackTransaction();
      }
      await holder.release();
    }
  });

  it('applies bootstrap, onboarding, document, and client webhook outbox migrations', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migrations = await dataSource.query(
      `SELECT name
       FROM migrations
       ORDER BY id`,
    );

    expect(migrations).toEqual([
      { name: '0001_init' },
      { name: '0002_create_onboardings_1735689600000' },
      { name: '0003_create_onboarding_documents_1784419200000' },
      { name: '0004_expand_onboarding_lifecycle_statuses_1784505600000' },
      { name: '0003_create_client_webhook_outbox_1784592000000' },
      { name: '0004_widen_document_size_columns_1784764800000' },
    ]);

    const tables = await dataSource.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    expect(tables).toEqual([
      { table_name: '_engine_alive' },
      { table_name: 'client_webhook_outbox' },
      { table_name: 'migrations' },
      { table_name: 'onboarding_documents' },
      { table_name: 'onboardings' },
    ]);

    const documentTable = await dataSource.query(
      "SELECT to_regclass('onboarding_documents') AS table_name",
    );
    expect(documentTable).toEqual([{ table_name: 'onboarding_documents' }]);
  });

  it('widens onboarding document size columns and restores the migration ledger after guarded down/up cycles', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migration = new WidenDocumentSizeColumns0004();
    const queryRunner = dataSource.createQueryRunner();
    const seededOnboardingIds: string[] = [];
    const seededDocumentIds: string[] = [];

    const readColumnMetadata = async () =>
      dataSource.query(
        `SELECT column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'onboarding_documents'
           AND column_name IN ('requested_max_size_bytes', 'verified_size_bytes')
         ORDER BY column_name`,
      );

    const readConstraintMetadata = async () =>
      dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.onboarding_documents'::regclass
           AND contype = 'c'
           AND conname IN (
             'chk_onboarding_documents_requested_max_size_positive',
             'chk_onboarding_documents_verified_size_positive'
           )
         ORDER BY conname`,
      );

    const readMigrationLedger = async () =>
      dataSource.query(`SELECT name FROM migrations ORDER BY id`);

    const restoreSchemaAndLedger = async () => {
      await dataSource.query('DELETE FROM migrations WHERE name = $1', [migration.name]);
      await dataSource.runMigrations();
    };

    try {
      await queryRunner.connect();

      const [seededOnboardingId] = await seedAdminOnboardingsFixtures([
        {
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user' as const,
          currentStep: 'collect_email',
          context: {},
          createdAt: '2026-07-23T00:00:00.000Z',
          updatedAt: '2026-07-23T00:00:00.000Z',
          completedAt: null,
          expiresAt: null,
        },
      ]);
      seededOnboardingIds.push(seededOnboardingId);

      const documentId = randomUUID();
      seededDocumentIds.push(documentId);

      await dataSource.query(
        `INSERT INTO onboarding_documents (
          id,
          onboarding_id,
          step_name,
          field_name,
          status,
          staging_object_key,
          final_object_key,
          requested_content_type,
          requested_max_size_bytes,
          verified_content_type,
          verified_size_bytes,
          verified_etag,
          expires_at,
          completed_at,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
        [
          documentId,
          seededOnboardingId,
          'collect_email',
          'identityDocument',
          'pending',
          'staging/object',
          null,
          'image/png',
          2147483648,
          null,
          2147483648,
          null,
          new Date(Date.now() + 60_000),
          null,
          new Date(),
          new Date(),
        ],
      );

      const repository = dataSource.getRepository(OnboardingDocumentEntity);
      const hydratedDocument = await repository.findOne({ where: { id: documentId } });

      expect(hydratedDocument?.requestedMaxSizeBytes).toBe(2147483648);
      expect(hydratedDocument?.verifiedSizeBytes).toBe(2147483648);

      await expect(readColumnMetadata()).resolves.toEqual([
        {
          column_name: 'requested_max_size_bytes',
          data_type: 'bigint',
          udt_name: 'int8',
          is_nullable: 'NO',
        },
        {
          column_name: 'verified_size_bytes',
          data_type: 'bigint',
          udt_name: 'int8',
          is_nullable: 'YES',
        },
      ]);

      await expect(readConstraintMetadata()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conname: 'chk_onboarding_documents_requested_max_size_positive',
            definition: expect.stringContaining('requested_max_size_bytes > 0'),
          }),
          expect.objectContaining({
            conname: 'chk_onboarding_documents_verified_size_positive',
            definition: expect.stringContaining('verified_size_bytes > 0'),
          }),
        ]),
      );

      await expect(migration.down(queryRunner)).rejects.toThrow(
        /2147483647.*requested_max_size_bytes|verified_size_bytes/i,
      );

      await dataSource.query(
        `UPDATE onboarding_documents
         SET requested_max_size_bytes = $1, verified_size_bytes = $2
         WHERE id = $3`,
        [2147483647, 2147483647, documentId],
      );

      await expect(migration.down(queryRunner)).resolves.toBeUndefined();

      await expect(readColumnMetadata()).resolves.toEqual([
        {
          column_name: 'requested_max_size_bytes',
          data_type: 'integer',
          udt_name: 'int4',
          is_nullable: 'NO',
        },
        {
          column_name: 'verified_size_bytes',
          data_type: 'integer',
          udt_name: 'int4',
          is_nullable: 'YES',
        },
      ]);

      await expect(migration.up(queryRunner)).resolves.toBeUndefined();
      await expect(readColumnMetadata()).resolves.toEqual([
        {
          column_name: 'requested_max_size_bytes',
          data_type: 'bigint',
          udt_name: 'int8',
          is_nullable: 'NO',
        },
        {
          column_name: 'verified_size_bytes',
          data_type: 'bigint',
          udt_name: 'int8',
          is_nullable: 'YES',
        },
      ]);
      await expect(readMigrationLedger()).resolves.toEqual(
        expect.arrayContaining([{ name: migration.name }]),
      );
    } finally {
      try {
        await restoreSchemaAndLedger();
      } finally {
        if (seededDocumentIds.length > 0) {
          await dataSource.query('DELETE FROM onboarding_documents WHERE id = ANY($1::uuid[])', [
            seededDocumentIds,
          ]);
        }
        if (seededOnboardingIds.length > 0) {
          await cleanupAdminOnboardingsFixtures(seededOnboardingIds);
        }
        await queryRunner.release();
      }
    }
  });

  it('asserts the durable onboardings schema shape and primary-key-only index inventory', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const tableResult = await dataSource.query("SELECT to_regclass('onboardings') AS table_name");
    expect(tableResult).toEqual([{ table_name: 'onboardings' }]);

    const columns = await dataSource.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'onboardings'
       ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      {
        column_name: 'id',
        data_type: 'uuid',
        udt_name: 'uuid',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'workflow_id',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'workflow_version',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'status',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'current_step',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'context',
        data_type: 'jsonb',
        udt_name: 'jsonb',
        is_nullable: 'NO',
        column_default: "'{}'::jsonb",
      },
      {
        column_name: 'expires_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'completed_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);

    const indexes = await dataSource.query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'onboardings'
       ORDER BY indexname`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexname).toBe('onboardings_pkey');
    expect(indexes[0].indexdef).toContain('UNIQUE INDEX onboardings_pkey');
    expect(indexes[0].indexdef).toContain('ON public.onboardings USING btree (id)');

    const constraints = await dataSource.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.onboardings'::regclass AND contype = 'c'
       ORDER BY conname`,
    );
    expect(constraints).toEqual(
      expect.arrayContaining([
        {
          conname: 'chk_onboardings_context_object',
          definition: "CHECK ((jsonb_typeof(context) = 'object'::text))",
        },
        {
          conname: 'chk_onboardings_current_step_nonempty',
          definition:
            "CHECK (((current_step IS NULL) OR (btrim((current_step)::text) <> ''::text)))",
        },
        {
          conname: 'chk_onboardings_workflow_id_nonempty',
          definition: "CHECK ((btrim((workflow_id)::text) <> ''::text))",
        },
        {
          conname: 'chk_onboardings_workflow_version_positive',
          definition: 'CHECK ((workflow_version > 0))',
        },
        expect.objectContaining({
          conname: 'chk_onboardings_lifecycle_state',
          definition: expect.stringContaining('awaiting_manual_review'),
        }),
        expect.objectContaining({
          conname: 'chk_onboardings_status',
          definition: expect.stringContaining('awaiting_manual_review'),
        }),
      ]),
    );
  });
});
