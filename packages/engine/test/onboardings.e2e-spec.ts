import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { HeadObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { WebhookEventType } from '../src/webhook/webhook-event';
import { WebhookOutboxStatus } from '../src/webhook/entity/webhook-outbox.entity';
import { WebhookService } from '../src/webhook/webhook.service';
import { MockPhoneVerificationConnector } from '../src/connectors/adapters/fixtures/mock-verification.connector';
import {
  MockKyc1Connector,
  MockKyc2Connector,
} from '../src/connectors/adapters/fixtures/mock-kyc.connector';
import { AddInvalidOnboardingStatus0009 } from '../src/database/migrations/0009_add_invalid_onboarding_status';
import { AddOnboardingRejectionReason0007 } from '../src/database/migrations/0007_add_onboarding_rejection_reason';
import { WidenDocumentSizeColumns0005 } from '../src/database/migrations/0005_widen_document_size_columns';
import { OnboardingDocumentEntity } from '../src/onboardings/entity/onboarding-document.entity';
import { OnboardingsRepository } from '../src/onboardings/onboardings.repository';
import { OnboardingsService } from '../src/onboardings/onboardings.service';
import { AuditService } from '../src/audit/audit.service';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';
import { ConnectorExecutionResult } from '../src/connectors/ports/connector-execution.port';
import { Workflow, WorkflowEvaluationResult } from '../src/workflows/domain/workflow';

const INVALID_STEP_DATA = {
  code: 'INVALID_STEP_DATA',
  message: 'INVALID_STEP_DATA',
  errors: {},
};

const OTP_INVALID_DATA = {
  code: 'INVALID_STEP_DATA',
  message: 'INVALID_STEP_DATA',
  errors: { verificationCode: ['INVALID'] },
};

const STRUCTURED_ROUNDTRIP_WORKFLOW_ID = 'structured-roundtrip';
const CONDITIONAL_FIELDS_TRANSITIONS_WORKFLOW_ID = 'conditional-fields-and-transitions';
const TWILIO_VERIFY_WORKFLOW_ID = 'twilio-verify';
const TWILIO_PHONE_NUMBER = '+15551234567';
// Twilio's own Verify service settings, which the mock reproduces.
const TWILIO_MAX_ATTEMPTS = 5;
const TWILIO_TTL_SECONDS = 600;

let clientWebhookTestUrl = '';
let localWebhookResponseMode: 'success' | 'failure' = 'success';
const originalClientWebhookBaseUrl = process.env.CLIENT_WEBHOOK_BASE_URL;

jest.setTimeout(30000);

describe('OnboardingsController (e2e)', () => {
  let app: NestExpressApplication | null = null;
  let localWebhookServer: Server | null = null;
  let workflowsDir: string | null = null;
  let pinnedWorkflowSpy: jest.SpyInstance | null = null;
  const capturedWebhookRequests: Array<{ method: string; path: string; body: unknown }> = [];
  const createdOnboardingIds = new Set<string>();

  const readRawRequestBody = async (request: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];

    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
  };

  const startLocalWebhookServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      localWebhookServer = createServer((request: IncomingMessage, response: ServerResponse) => {
        void readRawRequestBody(request).then((rawBody) => {
          let parsedBody: unknown = rawBody;
          if (rawBody.length > 0) {
            try {
              parsedBody = JSON.parse(rawBody);
            } catch {
              parsedBody = rawBody;
            }
          }

          const parsedUrl = new URL(request.url ?? '/', 'http://127.0.0.1');
          capturedWebhookRequests.push({
            method: request.method ?? '',
            path: parsedUrl.pathname,
            body: parsedBody,
          });

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

  /**
   * `getById` reads the table on every call and builds a fresh `Workflow`, so
   * spying on one returned instance would not reach the one a request builds.
   * Pinning the instance through the registry restores that identity for the
   * revision under test while every other lookup still hits the database.
   */
  const pinWorkflowInstance = async (workflowId: string, version: number): Promise<Workflow> => {
    const workflowRegistryService = getApp().get(WorkflowRegistryService);
    const originalGetById = workflowRegistryService.getById.bind(workflowRegistryService);
    const pinnedWorkflow = await originalGetById(workflowId, version);

    pinnedWorkflowSpy = jest
      .spyOn(workflowRegistryService, 'getById')
      .mockImplementation(async (requestedId, requestedVersion, manager) =>
        requestedId === workflowId &&
        (requestedVersion === undefined || requestedVersion === version)
          ? pinnedWorkflow
          : originalGetById(requestedId, requestedVersion, manager),
      );

    return pinnedWorkflow;
  };

  beforeAll(async () => {
    clientWebhookTestUrl = await startLocalWebhookServer();

    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-workflows-'));
    writeFileSync(
      path.join(workflowsDir, 'structured-roundtrip.workflow.json'),
      JSON.stringify(
        {
          id: STRUCTURED_ROUNDTRIP_WORKFLOW_ID,
          version: 1,
          name: 'Structured Roundtrip',
          initial: 'collect_structured',
          steps: [
            {
              name: 'collect_structured',
              status: 'awaiting_user',
              data: {
                profile: {
                  type: 'object',
                  required: true,
                  fields: {
                    profileId: {
                      type: 'text',
                      required: true,
                    },
                    links: {
                      type: 'array',
                      required: true,
                      items: {
                        type: 'text',
                        validation: {
                          format: 'uri',
                        },
                      },
                    },
                  },
                },
                tags: {
                  type: 'array',
                  required: true,
                  persist: false,
                  items: {
                    type: 'text',
                  },
                },
              },
              connectors: [
                {
                  name: 'mock_kyc_1',
                  id: 'mock_kyc_1',
                  type: 'kyc',
                  order: 1,
                  fieldMapping: {
                    profile: 'profile',
                    tags: 'tags',
                  },
                },
              ],
              transitions: [{ status: 'success', target: 'approved' }],
            },
            {
              name: 'approved',
              status: 'approved',
              data: {},
              transitions: [],
            },
          ],
        },
        null,
        2,
      ),
    );

    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.CLIENT_WEBHOOK_BASE_URL = clientWebhookTestUrl;
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;

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

  type AdminOnboardingsListBody = {
    items: Array<Record<string, unknown>>;
    meta: { pagination: { page: number; limit: number; total: number; totalPages: number } };
  };

  const getSeededAdminOnboardingSummaries = (
    responseBody: AdminOnboardingsListBody,
    seededIds: string[],
  ) =>
    responseBody.items.filter((item: Record<string, unknown>) =>
      seededIds.includes(item.onboardingId as string),
    );

  const expectSeededAdminOnboardingSummaries = (
    responseBody: AdminOnboardingsListBody,
    seededIds: string[],
    expectedSummaries: Array<Record<string, unknown>>,
  ) => {
    const seededResponses = getSeededAdminOnboardingSummaries(responseBody, seededIds);
    const expectedWithRejectionReason = expectedSummaries.map((summary) => ({
      rejectionReason: null,
      ...summary,
    }));

    expect(seededResponses).toEqual(expectedWithRejectionReason);
    expect(seededResponses.every((item: Record<string, unknown>) => !('context' in item))).toBe(
      true,
    );
  };

  const getAdminOnboardings = (query?: string | Record<string, string | string[]>) => {
    const requestBuilder = http().get('/v1/onboardings');

    if (query === undefined) {
      return requestBuilder;
    }

    if (typeof query === 'string') {
      return http().get(`/v1/onboardings${query}`);
    }

    return requestBuilder.query(query);
  };

  const withAdminOnboardingsPage = (
    query: string | Record<string, string | string[]> | undefined,
    page: number,
  ): string | Record<string, string | string[]> => {
    if (query === undefined || query === '') {
      return `?page=${page}`;
    }

    if (typeof query === 'string') {
      return `${query}&page=${page}`;
    }

    return { ...query, page: String(page) };
  };

  /**
   * Reads every page of the admin list for one query and concatenates the rows.
   *
   * The endpoint is paginated, and these fixtures are backdated to 2024 so that they sort behind
   * everything the suite creates live under the `createdAt DESC` ordering. Asserting against the
   * first page alone would start failing as soon as the run accumulated more than one page of
   * newer rows, which is a property of the suite rather than of the endpoint.
   */
  const getAllAdminOnboardings = async (
    query?: string | Record<string, string | string[]>,
  ): Promise<AdminOnboardingsListBody> => {
    const firstPage = await getAdminOnboardings(query).expect(200);
    const firstPageBody = firstPage.body as AdminOnboardingsListBody;
    const items = [...firstPageBody.items];

    for (let page = 2; page <= firstPageBody.meta.pagination.totalPages; page += 1) {
      const nextPage = await getAdminOnboardings(withAdminOnboardingsPage(query, page)).expect(200);
      items.push(...(nextPage.body as AdminOnboardingsListBody).items);
    }

    return { items, meta: firstPageBody.meta };
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
      status: 'awaiting_user' | 'awaiting_manual_review' | 'approved' | 'rejected' | 'invalid';
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

  const startWorkflowOnboarding = async (
    workflowId: string,
    expectedCurrentStep: string,
    expectedStatus: 'awaiting_user' | 'awaiting_manual_review',
  ) => {
    const response = await http().post('/v1/onboardings').send({ workflowId }).expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: expectedStatus,
      currentStep: expectedCurrentStep,
      expiresAt: null,
    });

    expect(response.body.onboardingId).not.toHaveLength(0);

    expect(await readOnboarding(response.body.onboardingId)).toEqual(
      expect.objectContaining({
        workflow_id: workflowId,
        workflow_version: 1,
        status: expectedStatus,
        current_step: expectedCurrentStep,
        context: {},
        completed_at: null,
      }),
    );

    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);
    return onboardingId;
  };

  const startOnboarding = async () =>
    startWorkflowOnboarding('base', 'collect_email', 'awaiting_user');

  const startStructuredRoundtripOnboarding = async () =>
    startWorkflowOnboarding(
      STRUCTURED_ROUNDTRIP_WORKFLOW_ID,
      'collect_structured',
      'awaiting_user',
    );

  const startConditionalWorkflowOnboarding = async () =>
    startWorkflowOnboarding(
      CONDITIONAL_FIELDS_TRANSITIONS_WORKFLOW_ID,
      'collect_country',
      'awaiting_user',
    );

  const startOtpOnboarding = async (workflowId: typeof TWILIO_VERIFY_WORKFLOW_ID) =>
    startWorkflowOnboarding(workflowId, 'request_code', 'awaiting_user');

  /**
   * CONNECTOR_MOCKS hands `twilio_verify` to this fixture for the whole suite, so the
   * shipped workflow runs unchanged and no test needs to fake provider HTTP.
   */
  const twilioVerifyMock = (): MockPhoneVerificationConnector =>
    getApp().get(MockPhoneVerificationConnector);

  const startManualReviewOnboarding = async () => {
    return startWorkflowOnboarding(
      'manual-review',
      'awaiting_manual_review',
      'awaiting_manual_review',
    );
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
      event_type: WebhookEventType;
      endpoint_url: string;
      status: WebhookOutboxStatus;
      attempts: number;
      delivered_at: string | null;
      payload: {
        version: 1;
        event: { id: string; type: string; occurredAt: string };
        onboarding: {
          id: string;
          workflowId: string;
          workflowVersion: number;
          status: 'awaiting_user' | 'approved' | 'rejected' | 'invalid';
          currentStep: string | null;
          completedAt: string | null;
        };
      };
    }>;
  };

  afterEach(() => {
    capturedWebhookRequests.length = 0;
    pinnedWorkflowSpy?.mockRestore();
    pinnedWorkflowSpy = null;
  });

  const assertMetadataOnlyPayloadShape = (payload: Record<string, unknown>) => {
    expect(Object.keys(payload).sort()).toEqual(['event', 'onboarding', 'version']);
    expect(payload).not.toHaveProperty('context');
    expect(payload).not.toHaveProperty('submittedData');
    expect(payload).not.toHaveProperty('connectorPayload');
    expect(payload).not.toHaveProperty('responseBody');
    expect(payload).not.toHaveProperty('errorBody');
  };

  const BASE_TERMINAL_NOTIFY_PATH = '/notify';

  const expectTerminalInvalidWithPreservedContext = async (
    id: string,
    body: unknown,
    expectedContext: Record<string, unknown>,
    expectedAppliedStep: string | null,
    expectedNotifyPath: string,
  ) => {
    const outboxRowsBefore = await readOutboxRowsForOnboarding(id);

    const response = await http()
      .post(`/v1/onboardings/${id}/submit`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body))
      .expect((submitResponse) => expect([200, 201]).toContain(submitResponse.status));

    expect(response.body).toEqual({
      appliedStep: expectedAppliedStep,
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });
    expect(response.body).not.toHaveProperty('errors');
    expect(response.body).not.toHaveProperty('reason');
    expect(response.body).not.toHaveProperty('details');

    const onboarding = await readOnboarding(id);
    expect(onboarding).toEqual(
      expect.objectContaining({
        status: 'invalid',
        current_step: null,
        context: expectedContext,
        completed_at: expect.anything(),
      }),
    );

    const outboxRows = await readOutboxRowsForOnboarding(id);
    expect(outboxRows).toHaveLength(outboxRowsBefore.length + 1);
    const newOutboxRow = outboxRows[outboxRows.length - 1];

    expect(newOutboxRow).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}${expectedNotifyPath}`,
      }),
    );
    expect(newOutboxRow.payload).toEqual(
      expect.objectContaining({
        version: 1,
        onboarding: {
          id,
          workflowId: onboarding.workflow_id,
          workflowVersion: onboarding.workflow_version,
          status: 'invalid',
          currentStep: null,
          completedAt: expect.any(String),
        },
      }),
    );

    expect(capturedWebhookRequests).toHaveLength(0);
  };

  const expectRetryableInvalidStepDataWithPreservedState = async (
    id: string,
    body: unknown,
    expectedErrors: Record<string, readonly string[]>,
    expectedState?: {
      status: 'awaiting_user' | 'awaiting_manual_review' | 'approved' | 'rejected' | 'invalid';
      currentStep: string | null;
      context: Record<string, unknown>;
      completedAt: unknown;
    },
  ) => {
    const before = await readOnboarding(id);

    const response = await http()
      .post(`/v1/onboardings/${id}/submit`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body))
      .expect(400);

    expect(response.body).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors: expectedErrors,
    });

    const after = await readOnboarding(id);
    if (expectedState) {
      expect(after).toEqual(
        expect.objectContaining({
          status: expectedState.status,
          current_step: expectedState.currentStep,
          context: expectedState.context,
          completed_at: expectedState.completedAt,
        }),
      );
    } else {
      expect(after).toEqual(before);
    }
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

    // Startup published this throwaway workflow into the shared workflows table;
    // leaving it there would let a stale definition outlive the temporary directory.
    if (app) {
      await app
        .get(DataSource)
        .query('DELETE FROM workflows WHERE workflow_id = $1', [STRUCTURED_ROUNDTRIP_WORKFLOW_ID]);
    }

    if (app) {
      await app.close();
    }

    await closeLocalWebhookServer();

    if (originalClientWebhookBaseUrl === undefined) {
      delete process.env.CLIENT_WEBHOOK_BASE_URL;
    } else {
      process.env.CLIENT_WEBHOOK_BASE_URL = originalClientWebhookBaseUrl;
    }

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  it('starts a base onboarding in the first awaiting-user step', async () => {
    await startOnboarding();
  });

  it('creates a pending outbox snapshot without a webhook request on onboarding creation', async () => {
    const onboardingId = await startOnboarding();
    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);

    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        status: WebhookOutboxStatus.PENDING,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(capturedWebhookRequests).toHaveLength(0);
  });

  it('commits onboarding creation successfully even when local webhook endpoint would fail', async () => {
    const previousWebhookResponseMode = localWebhookResponseMode;
    localWebhookResponseMode = 'failure';

    try {
      const onboardingId = await startOnboarding();
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          workflow_id: 'base',
          workflow_version: 1,
          status: 'awaiting_user',
          current_step: 'collect_email',
          context: {},
          completed_at: null,
        }),
      );
      const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]).toEqual(
        expect.objectContaining({
          event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
          status: WebhookOutboxStatus.PENDING,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
          attempts: 0,
          delivered_at: null,
        }),
      );
      expect(capturedWebhookRequests).toHaveLength(0);
    } finally {
      localWebhookResponseMode = previousWebhookResponseMode;
    }
  });

  it('does not create a webhook when first submit reaches opted-out accept_terms', async () => {
    const onboardingId = await startOnboarding();
    const outboxRowsBeforeSubmit = await readOutboxRowsForOnboarding(onboardingId);
    const requestsBeforeSubmit = capturedWebhookRequests.length;

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const onboardingRows = await readOnboarding(onboardingId);
    expect(onboardingRows).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'accept_terms',
        context: { email: 'person@example.com' },
      }),
    );

    const outboxRowsAfterSubmit = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRowsAfterSubmit).toHaveLength(outboxRowsBeforeSubmit.length);
    expect(capturedWebhookRequests).toHaveLength(requestsBeforeSubmit);
  });

  it('persists exactly one onboarding.state_changed outbox row on terminal approved state', async () => {
    const onboardingId = await startOnboarding();
    const outboxRowsBeforeTerminalSubmit = await readOutboxRowsForOnboarding(onboardingId);
    const requestsBeforeTerminalSubmit = capturedWebhookRequests.length;

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(await readOutboxRowsForOnboarding(onboardingId)).toHaveLength(
      outboxRowsBeforeTerminalSubmit.length,
    );
    expect(capturedWebhookRequests).toHaveLength(requestsBeforeTerminalSubmit);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(await readOutboxRowsForOnboarding(onboardingId)).toHaveLength(
      outboxRowsBeforeTerminalSubmit.length + 1,
    );
    expect(capturedWebhookRequests).toHaveLength(requestsBeforeTerminalSubmit);

    const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRows).toHaveLength(outboxRowsBeforeTerminalSubmit.length + 1);
    const terminalRow = outboxRows[outboxRows.length - 1];
    expect([terminalRow].map((row) => row.event_type)).toEqual([
      WebhookEventType.ONBOARDING_STATE_CHANGED,
    ]);
    expect(terminalRow.status).toBe('PENDING');
    expect(terminalRow.attempts).toBe(0);
    expect(terminalRow.delivered_at).toBeNull();
    expect(terminalRow.endpoint_url).toBe(`${clientWebhookTestUrl}/notify`);

    const stateChangedPayload = terminalRow.payload;
    expect(stateChangedPayload.event.type).toBe(WebhookEventType.ONBOARDING_STATE_CHANGED);
    expect(stateChangedPayload.onboarding).toEqual({
      id: onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'approved',
      currentStep: null,
      completedAt: expect.any(String),
    });
    assertMetadataOnlyPayloadShape(stateChangedPayload as Record<string, unknown>);
    const outboxRowsBeforeCompletedSubmit = await readOutboxRowsForOnboarding(onboardingId);
    const requestsBeforeCompletedSubmit = capturedWebhookRequests.length;
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });

    const outboxRowsAfterCompletedSubmit = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRowsAfterCompletedSubmit).toHaveLength(outboxRowsBeforeCompletedSubmit.length + 1);
    const completedSubmitRow =
      outboxRowsAfterCompletedSubmit[outboxRowsAfterCompletedSubmit.length - 1];
    expect(completedSubmitRow).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(completedSubmitRow.payload.onboarding).toEqual({
      id: onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'approved',
      currentStep: null,
      completedAt: expect.any(String),
    });
    assertMetadataOnlyPayloadShape(completedSubmitRow.payload as Record<string, unknown>);

    expect(capturedWebhookRequests).toHaveLength(requestsBeforeCompletedSubmit);
  });

  it('returns retryable INVALID_STEP_DATA for semantic invalid payloads without mutating state', async () => {
    const onboardingId = await startOnboarding();
    await expectRetryableInvalidStepDataWithPreservedState(
      onboardingId,
      { email: 'not-an-email' },
      { email: ['INVALID'] },
    );

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_email',
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        rejectionReason: null,
      });
  });

  it('succeeds and leaves onboarding committed and the outbox pending when delivery fails after submit', async () => {
    const onboardingId = await startOnboarding();

    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockImplementation(async () => ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockImplementation(async () => ConnectorExecutionResult.accepted());
    const previousWebhookResponseMode = localWebhookResponseMode;
    localWebhookResponseMode = 'failure';

    try {
      capturedWebhookRequests.length = 0;

      const firstResponse = await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'person@example.com' })
        .expect((response) => expect([200, 201]).toContain(response.status));

      expect(firstResponse.body).toEqual({
        appliedStep: 'collect_email',
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        rejectionReason: null,
      });

      const firstOutboxRows = await readOutboxRowsForOnboarding(onboardingId);
      expect(firstOutboxRows).toHaveLength(1);
      expect(capturedWebhookRequests).toHaveLength(0);

      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect((result) => expect([200, 201]).toContain(result.status));

      expect(response.body).toEqual({
        appliedStep: 'accept_terms',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });

      const outboxRows = await readOutboxRowsForOnboarding(onboardingId);
      expect(outboxRows).toHaveLength(2);

      const pendingRow = outboxRows[outboxRows.length - 1];
      expect(pendingRow).toEqual(
        expect.objectContaining({
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
          payload: expect.objectContaining({
            version: 1,
            event: expect.objectContaining({
              type: WebhookEventType.ONBOARDING_STATE_CHANGED,
            }),
            onboarding: expect.objectContaining({
              id: onboardingId,
              workflowId: 'base',
              workflowVersion: 1,
              status: 'approved',
              currentStep: null,
              completedAt: expect.any(String),
            }),
          }),
        }),
      );

      const pendingPayload = pendingRow.payload;
      expect(pendingPayload.event.type).toBe(WebhookEventType.ONBOARDING_STATE_CHANGED);
      expect(pendingPayload.onboarding).toEqual({
        id: onboardingId,
        workflowId: 'base',
        workflowVersion: 1,
        status: 'approved',
        currentStep: null,
        completedAt: expect.any(String),
      });
      assertMetadataOnlyPayloadShape(pendingPayload as Record<string, unknown>);
      expect(capturedWebhookRequests).toHaveLength(0);
      expect(firstExecuteSpy).toHaveBeenCalled();
      expect(secondExecuteSpy).toHaveBeenCalled();

      const onboardingRow = await readOnboarding(onboardingId);
      expect(onboardingRow).toEqual(
        expect.objectContaining({
          status: 'approved',
          current_step: null,
          completed_at: expect.anything(),
          context: { email: 'person@example.com', acceptedTerms: true },
        }),
      );

      expect(pendingRow).toEqual(
        expect.objectContaining({
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
          payload: expect.objectContaining({
            version: 1,
            event: expect.objectContaining({
              type: WebhookEventType.ONBOARDING_STATE_CHANGED,
            }),
            onboarding: expect.objectContaining({
              id: onboardingId,
              workflowId: 'base',
              workflowVersion: 1,
              status: 'approved',
              currentStep: null,
              completedAt: expect.any(String),
            }),
          }),
        }),
      );

      expect(capturedWebhookRequests).toHaveLength(0);
    } finally {
      firstExecuteSpy.mockRestore();
      secondExecuteSpy.mockRestore();
      localWebhookResponseMode = previousWebhookResponseMode;
    }
  });

  it('keeps manual review transitions successful when notify would fail after the state change', async () => {
    const onboardingId = await startManualReviewOnboarding();
    const previousWebhookResponseMode = localWebhookResponseMode;
    const requestsBefore = capturedWebhookRequests.length;
    localWebhookResponseMode = 'failure';

    try {
      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/review/approve`)
        .expect(200);

      expect(response.body).toEqual({
        appliedStep: 'awaiting_manual_review',
        status: 'approved',
        currentStep: null,
      });
      expect(capturedWebhookRequests).toHaveLength(requestsBefore);
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'approved',
          current_step: null,
          completed_at: expect.anything(),
          context: {},
        }),
      );
      const manualRows = await readOutboxRowsForOnboarding(onboardingId);
      expect(manualRows).toHaveLength(2);
      expect(manualRows[1]).toEqual(
        expect.objectContaining({
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
        }),
      );
    } finally {
      localWebhookResponseMode = previousWebhookResponseMode;
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
      const response = await getAllAdminOnboardings();

      expectSeededAdminOnboardingSummaries(response, seededIds, [
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

  it('wraps the admin onboarding list in a paginated envelope with the default window', async () => {
    const response = await getAdminOnboardings().expect(200);

    expect(response.body).toEqual({
      items: expect.any(Array),
      meta: {
        pagination: expect.objectContaining({
          page: 1,
          limit: 20,
        }),
      },
    });

    const items = response.body.items as Array<Record<string, unknown>>;
    const pagination = response.body.meta.pagination as {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };

    expect(items.length).toBeLessThanOrEqual(pagination.limit);
    expect(pagination.total).toBeGreaterThanOrEqual(items.length);
    expect(pagination.totalPages).toBe(Math.ceil(pagination.total / pagination.limit));
  });

  it('splits admin onboarding summaries across pages without repeating or dropping a row', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-paged',
        workflowVersion: 91,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-page-1' },
        createdAt: '2024-08-01T00:00:00.000Z',
        updatedAt: '2024-08-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-paged',
        workflowVersion: 92,
        status: 'awaiting_user' as const,
        currentStep: 'accept_terms',
        context: { source: 'seed-page-2' },
        createdAt: '2024-08-02T00:00:00.000Z',
        updatedAt: '2024-08-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-paged',
        workflowVersion: 93,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-page-3' },
        createdAt: '2024-08-03T00:00:00.000Z',
        updatedAt: '2024-08-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const firstPage = await getAdminOnboardings('?workflowId=workflow-paged&limit=2').expect(200);

      expect(firstPage.body.meta.pagination).toEqual({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(
        (firstPage.body.items as Array<Record<string, unknown>>).map((item) => item.onboardingId),
      ).toEqual([seededIds[2], seededIds[1]]);

      const secondPage = await getAdminOnboardings(
        '?workflowId=workflow-paged&limit=2&page=2',
      ).expect(200);

      expect(secondPage.body.meta.pagination).toEqual({
        page: 2,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
      expect(
        (secondPage.body.items as Array<Record<string, unknown>>).map((item) => item.onboardingId),
      ).toEqual([seededIds[0]]);

      const beyondLastPage = await getAdminOnboardings(
        '?workflowId=workflow-paged&limit=2&page=9',
      ).expect(200);

      expect(beyondLastPage.body.items).toEqual([]);
      expect(beyondLastPage.body.meta.pagination).toEqual({
        page: 9,
        limit: 2,
        total: 3,
        totalPages: 2,
      });
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it.each([
    ['zero page', '?page=0'],
    ['negative page', '?page=-1'],
    ['decimal page', '?page=1.5'],
    ['non-numeric page', '?page=abc'],
    ['blank page', '?page='],
    ['repeated page', '?page=1&page=2'],
    ['zero limit', '?limit=0'],
    ['decimal limit', '?limit=1.5'],
    ['non-numeric limit', '?limit=abc'],
    ['blank limit', '?limit='],
    ['limit above the maximum', '?limit=101'],
  ])('rejects %s through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
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
      const response = await getAllAdminOnboardings('?workflowVersion=22');

      expectSeededAdminOnboardingSummaries(response, seededIds, [
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
      const response = await getAllAdminOnboardings('?currentStep=accept_terms');

      expectSeededAdminOnboardingSummaries(response, seededIds, [
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
      const response = await getAllAdminOnboardings(`?onboardingId=${seededIds[1]}`);

      expectSeededAdminOnboardingSummaries(response, seededIds, [
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
      const statusAndVersionResponse = await getAllAdminOnboardings(
        '?status=approved&workflowVersion=52',
      );
      expectSeededAdminOnboardingSummaries(statusAndVersionResponse, seededIds, [
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

      const workflowAndStepResponse = await getAllAdminOnboardings(
        '?workflowId=workflow-beta&currentStep=review_profile',
      );
      expectSeededAdminOnboardingSummaries(workflowAndStepResponse, seededIds, [
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

      expect(response.body.items).toEqual([]);
      expect(response.body.meta.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      });
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
      const response = await getAllAdminOnboardings('?status=awaiting_user');
      const seededResponses = getSeededAdminOnboardingSummaries(response, seededIds);

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

  it('filters admin onboarding summaries by invalid status', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'invalid' as const,
        currentStep: null,
        context: { source: 'seed-invalid-status' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-01-01T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAllAdminOnboardings('?status=invalid');
      const seededResponses = getSeededAdminOnboardingSummaries(response, seededIds);

      expect(seededResponses).toHaveLength(1);
      expect(seededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[0],
          status: 'invalid',
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
      const response = await getAllAdminOnboardings('?workflowId=workflow-b');
      const seededResponses = getSeededAdminOnboardingSummaries(response, seededIds);

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
      const combinedResponse = await getAllAdminOnboardings(
        '?status=awaiting_user&workflowId=workflow-b',
      );
      const combinedSeededResponses = getSeededAdminOnboardingSummaries(
        combinedResponse,
        seededIds,
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
        .get('/v1/onboardings?status=approved&workflowId=does-not-exist')
        .expect(200);
      expect(noMatchResponse.body.items).toEqual([]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it.each([
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
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    expect(firstConnector.id).toBe('mock_kyc_1');
    expect(secondConnector.id).toBe('mock_kyc_2');
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_email',
        status: 'awaiting_user',
        currentStep: 'accept_terms',
        rejectionReason: null,
      });

    expect(firstExecuteSpy).toHaveBeenCalledWith({
      declaration: {
        order: 1,
        config: {},
        async: false,
      },
      execution: { onboardingId, stepName: 'collect_email' },
      context: { email: 'person@example.com' },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(firstExecuteSpy).toHaveBeenCalledTimes(1);
    expect(secondExecuteSpy).not.toHaveBeenCalled();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'accept_terms',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.completed_at).not.toBeNull();
    expect(completed.context).toEqual({ email: 'person@example.com', acceptedTerms: true });

    expect(secondExecuteSpy).toHaveBeenCalledWith({
      declaration: {
        order: 2,
        config: {},
        async: false,
      },
      execution: { onboardingId, stepName: 'accept_terms' },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com', acceptedTerms: true },
      payloadFieldSources: {
        email: 'email',
        acceptedTerms: 'acceptedTerms',
      },
    });
    expect(secondExecuteSpy).toHaveBeenCalledTimes(1);
    expect(firstExecuteSpy).toHaveBeenNthCalledWith(2, {
      declaration: {
        order: 1,
        config: {},
        async: false,
      },
      execution: { onboardingId, stepName: 'accept_terms' },
      context: { email: 'person@example.com', acceptedTerms: true },
      payload: { email: 'person@example.com' },
      payloadFieldSources: { email: 'email' },
    });
    expect(firstExecuteSpy).toHaveBeenCalledTimes(2);

    const firstConnectorSecondCallOrder = firstExecuteSpy.mock.invocationCallOrder[1];
    const secondConnectorFirstCallOrder = secondExecuteSpy.mock.invocationCallOrder[0];
    expect(firstConnectorSecondCallOrder).toBeDefined();
    expect(secondConnectorFirstCallOrder).toBeDefined();
    expect(firstConnectorSecondCallOrder).toBeLessThan(secondConnectorFirstCallOrder);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    expect(await readOnboarding(onboardingId)).toEqual(completed);
    firstExecuteSpy.mockRestore();
    secondExecuteSpy.mockRestore();
  });

  it('persists structured root fields in JSONB while excluding root persist:false data from context', async () => {
    const onboardingId = await startStructuredRoundtripOnboarding();
    const firstConnector = getApp().get(MockKyc1Connector);
    const verifySpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    const submittedData = {
      profile: {
        profileId: 'profile-123',
        links: ['https://tsh.io/docs', 'https://tsh.io/blog'],
      },
      tags: ['alpha', 'beta'],
    };

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(submittedData)
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_structured',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });

    expect(verifySpy).toHaveBeenCalledWith({
      declaration: {
        order: 1,
        config: {},
        async: false,
      },
      execution: { onboardingId, stepName: 'collect_structured' },
      context: submittedData,
      payload: submittedData,
      payloadFieldSources: {
        profile: 'profile',
        tags: 'tags',
      },
    });
    expect(verifySpy).toHaveBeenCalledTimes(1);

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.completed_at).not.toBeNull();
    expect(completed.context).toEqual({
      profile: submittedData.profile,
    });
    expect(JSON.stringify(completed.context)).toContain('profile-123');
    expect(JSON.stringify(completed.context)).not.toContain('alpha');
    expect(JSON.stringify(completed.context)).not.toContain('beta');

    verifySpy.mockRestore();
  });

  it('activates a later required field from persisted selector context and preserves the existing INVALID_STEP_DATA contract', async () => {
    const onboardingId = await startConditionalWorkflowOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ country: 'US' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_country',
        status: 'awaiting_user',
        currentStep: 'collect_details',
        rejectionReason: null,
      });

    const before = await readOnboarding(onboardingId);

    const response = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ currentOnly: 'visible' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { taxId: ['REQUIRED'] },
      });

    expect(response.body).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors: { taxId: ['REQUIRED'] },
    });

    const after = await readOnboarding(onboardingId);
    expect(after).toEqual(before);
    expect(after.context).toEqual({ country: 'US' });
    expect(after.context).not.toHaveProperty('taxId');
    expect(after.context).not.toHaveProperty('currentOnly');
  });

  it('rejects inactive supplied fields as UNKNOWN without mutating state or persisting them', async () => {
    const onboardingId = await startConditionalWorkflowOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ country: 'CA' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_country',
        status: 'awaiting_user',
        currentStep: 'collect_details',
        rejectionReason: null,
      });

    const before = await readOnboarding(onboardingId);

    const response = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ taxId: 'ABC' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { taxId: ['UNKNOWN'] },
      });

    expect(response.body).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors: { taxId: ['UNKNOWN'] },
    });

    const after = await readOnboarding(onboardingId);
    expect(after).toEqual(before);
    expect(after.context).toEqual({ country: 'CA' });
    expect(after.context).not.toHaveProperty('taxId');
  });

  it('selects the US conditional transition and fails fast when inactive mapped sources are required by the connector', async () => {
    const matchingOnboardingId = await startConditionalWorkflowOnboarding();
    const firstConnector = getApp().get(MockKyc1Connector);
    const verifySpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    await http()
      .post(`/v1/onboardings/${matchingOnboardingId}/submit`)
      .send({ country: 'US' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const matchingResponse = await http()
      .post(`/v1/onboardings/${matchingOnboardingId}/submit`)
      .send({ taxId: 'ABC', currentOnly: 'visible' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(matchingResponse.body).toEqual({
      appliedStep: 'collect_details',
      status: 'awaiting_manual_review',
      currentStep: 'review_us',
      rejectionReason: null,
    });

    expect(verifySpy).toHaveBeenCalledWith(
      expect.objectContaining({
        execution: { onboardingId: matchingOnboardingId, stepName: 'collect_details' },
        context: { country: 'US', taxId: 'ABC', currentOnly: 'visible' },
        payload: { country: 'US', taxId: 'ABC', currentOnly: 'visible' },
        payloadFieldSources: {
          country: 'country',
          taxId: 'taxId',
          currentOnly: 'currentOnly',
        },
      }),
    );
    expect(verifySpy).toHaveBeenCalledTimes(1);

    const matchingState = await readOnboarding(matchingOnboardingId);
    expect(matchingState.context).toEqual({ country: 'US', taxId: 'ABC' });
    expect(matchingState.context).not.toHaveProperty('currentOnly');

    verifySpy.mockRestore();

    await http()
      .post(`/v1/onboardings/${matchingOnboardingId}/review/approve`)
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'review_us',
        status: 'approved',
        currentStep: null,
      });

    const fallbackOnboardingId = await startConditionalWorkflowOnboarding();
    const fallbackConnector = getApp().get(MockKyc1Connector);
    const fallbackVerifySpy = jest
      .spyOn(fallbackConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    await http()
      .post(`/v1/onboardings/${fallbackOnboardingId}/submit`)
      .send({ country: 'CA' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const fallbackStateBeforeInvalidSubmit = await readOnboarding(fallbackOnboardingId);

    await http().post(`/v1/onboardings/${fallbackOnboardingId}/submit`).send({}).expect(500);

    expect(fallbackVerifySpy).not.toHaveBeenCalled();

    const fallbackState = await readOnboarding(fallbackOnboardingId);
    expect(fallbackState).toEqual(fallbackStateBeforeInvalidSubmit);
    expect(fallbackState.context).toEqual({ country: 'CA' });
    expect(fallbackState.context).not.toHaveProperty('taxId');
    expect(fallbackState.context).not.toHaveProperty('currentOnly');

    fallbackVerifySpy.mockRestore();
  });

  it('uses persisted context for manual transition conditions without mutating the stored context', async () => {
    const onboardingId = await startConditionalWorkflowOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ country: 'US' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ taxId: 'ABC', currentOnly: 'visible' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_details',
        status: 'awaiting_manual_review',
        currentStep: 'review_us',
        rejectionReason: null,
      });

    const before = await readOnboarding(onboardingId);
    const response = await http()
      .post(`/v1/onboardings/${onboardingId}/review/approve`)
      .expect((submitResponse) => expect([200, 201]).toContain(submitResponse.status))
      .expect({
        appliedStep: 'review_us',
        status: 'approved',
        currentStep: null,
      });

    expect(response.body).toEqual({
      appliedStep: 'review_us',
      status: 'approved',
      currentStep: null,
    });

    const after = await readOnboarding(onboardingId);
    expect(after.status).toBe('approved');
    expect(after.current_step).toBeNull();
    expect(after.context).toEqual(before.context);
    expect(after.context).toEqual({ country: 'US', taxId: 'ABC' });
    expect(after.context).not.toHaveProperty('currentOnly');
  });

  it('does not invoke connectors for invalid submit input and keeps onboarding state unchanged', async () => {
    const onboardingId = await startOnboarding();
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    await expectRetryableInvalidStepDataWithPreservedState(
      onboardingId,
      { email: 'not-an-email' },
      { email: ['INVALID'] },
    );

    expect(firstExecuteSpy).not.toHaveBeenCalled();
    expect(secondExecuteSpy).not.toHaveBeenCalled();

    firstExecuteSpy.mockRestore();
    secondExecuteSpy.mockRestore();
  });

  it('completes the Twilio Verify flow against the mock, keeping the code out of persistence', async () => {
    const onboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'request_code',
        status: 'awaiting_user',
        currentStep: 'verify_code',
        rejectionReason: null,
      });

    const generatedCode = twilioVerifyMock().__peekCodeForTests(onboardingId);
    expect(generatedCode).toMatch(/^\d{6}$/);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ verificationCode: generatedCode })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'verify_code',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.context).toEqual({ phoneNumber: TWILIO_PHONE_NUMBER });
    expect(JSON.stringify(completed.context)).not.toContain('verificationCode');
    expect(JSON.stringify(completed.context)).not.toContain(String(generatedCode));
  });

  it('returns INVALID_STEP_DATA field errors for a non-final wrong code and preserves active verification state', async () => {
    const onboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const before = await readOnboarding(onboardingId);
    const generatedCode = twilioVerifyMock().__peekCodeForTests(onboardingId);
    const outboxRowsBeforeInvalid = await readOutboxRowsForOnboarding(onboardingId);
    const webhookRequestsBeforeInvalid = capturedWebhookRequests.length;

    const invalidResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ verificationCode: '000000' })
      .expect(400);

    expect(invalidResponse.body).toEqual(OTP_INVALID_DATA);
    const outboxRowsAfterInvalid = await readOutboxRowsForOnboarding(onboardingId);
    expect(outboxRowsAfterInvalid).toHaveLength(outboxRowsBeforeInvalid.length);
    expect(capturedWebhookRequests).toHaveLength(webhookRequestsBeforeInvalid);
    const afterInvalid = await readOnboarding(onboardingId);
    expect(afterInvalid.status).toBe('awaiting_user');
    expect(afterInvalid.current_step).toBe('verify_code');
    expect(afterInvalid.context).toEqual(before.context);
    expect(afterInvalid.context).toEqual({ phoneNumber: TWILIO_PHONE_NUMBER });
    expect(JSON.stringify(afterInvalid.context)).not.toContain('verificationCode');

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ verificationCode: generatedCode })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'verify_code',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });
  });

  it('routes verification exhaustion, TTL expiry, and missing challenge to terminal rejected without INVALID_STEP_DATA', async () => {
    const exhaustedOnboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);
    await http()
      .post(`/v1/onboardings/${exhaustedOnboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((response) => expect([200, 201]).toContain(response.status));

    for (let attempt = 1; attempt < TWILIO_MAX_ATTEMPTS; attempt += 1) {
      await http()
        .post(`/v1/onboardings/${exhaustedOnboardingId}/submit`)
        .send({ verificationCode: String(attempt).repeat(6) })
        .expect(400)
        .expect(OTP_INVALID_DATA);
    }

    const exhaustedResponse = await http()
      .post(`/v1/onboardings/${exhaustedOnboardingId}/submit`)
      .send({ verificationCode: '999999' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(exhaustedResponse.body).toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'ATTEMPTS_EXHAUSTED',
    });
    expect(exhaustedResponse.body).not.toEqual(INVALID_STEP_DATA);

    const exhaustedState = await readOnboarding(exhaustedOnboardingId);
    expect(exhaustedState.status).toBe('rejected');
    expect(exhaustedState.current_step).toBeNull();
    expect(exhaustedState.context).toEqual({ phoneNumber: TWILIO_PHONE_NUMBER });
    expect(JSON.stringify(exhaustedState.context)).not.toContain('verificationCode');

    twilioVerifyMock().__setNowForTests(() => 1_000);

    const expiredOnboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);
    await http()
      .post(`/v1/onboardings/${expiredOnboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const expiredCode = twilioVerifyMock().__peekCodeForTests(expiredOnboardingId);
    twilioVerifyMock().__setNowForTests(() => 1_000 + (TWILIO_TTL_SECONDS + 1) * 1_000);

    const expiredResponse = await http()
      .post(`/v1/onboardings/${expiredOnboardingId}/submit`)
      .send({ verificationCode: expiredCode })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(expiredResponse.body).toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'CHALLENGE_EXPIRED',
    });
    expect(expiredResponse.body).not.toEqual(INVALID_STEP_DATA);

    const expiredState = await readOnboarding(expiredOnboardingId);
    expect(expiredState.status).toBe('rejected');
    expect(expiredState.current_step).toBeNull();
    expect(expiredState.context).toEqual({ phoneNumber: TWILIO_PHONE_NUMBER });
    expect(JSON.stringify(expiredState.context)).not.toContain('verificationCode');

    twilioVerifyMock().__resetForTests();

    const missingChallengeOnboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);
    await http()
      .post(`/v1/onboardings/${missingChallengeOnboardingId}/submit`)
      .send({ phoneNumber: TWILIO_PHONE_NUMBER })
      .expect((response) => expect([200, 201]).toContain(response.status));

    // Whatever the provider knew about this verification is gone, as after a restart.
    twilioVerifyMock().__resetForTests();

    const missingChallengeResponse = await http()
      .post(`/v1/onboardings/${missingChallengeOnboardingId}/submit`)
      .send({ verificationCode: '123456' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(missingChallengeResponse.body).toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'CHALLENGE_NOT_FOUND',
    });
    expect(missingChallengeResponse.body).not.toEqual(INVALID_STEP_DATA);

    const missingChallengeState = await readOnboarding(missingChallengeOnboardingId);
    expect(missingChallengeState.status).toBe('rejected');
    expect(missingChallengeState.current_step).toBeNull();
    expect(missingChallengeState.context).toEqual({ phoneNumber: TWILIO_PHONE_NUMBER });
    expect(JSON.stringify(missingChallengeState.context)).not.toContain('verificationCode');
  });

  it('rejects non-E.164 Twilio Verify phone numbers before the connector runs', async () => {
    const onboardingId = await startOtpOnboarding(TWILIO_VERIFY_WORKFLOW_ID);

    const response = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ phoneNumber: '5551234567' })
      .expect(400);

    expect(response.body).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors: { phoneNumber: ['INVALID'] },
    });
    expect(twilioVerifyMock().__peekCodeForTests(onboardingId)).toBeUndefined();

    const rejected = await readOnboarding(onboardingId);
    expect(rejected.status).toBe('awaiting_user');
    expect(rejected.current_step).toBe('request_code');
    expect(rejected.context).toEqual({});
  });

  it('applies approve, reject, and invalid review actions with exact lifecycle projections', async () => {
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

    const invalidOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${invalidOnboardingId}/review/invalid`)
      .expect(200)
      .expect({ appliedStep: 'awaiting_manual_review', status: 'invalid', currentStep: null });
    expect(await readOnboarding(invalidOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'invalid',
        current_step: null,
        completed_at: expect.anything(),
        context: {},
      }),
    );

    const returnOnboardingId = await startManualReviewOnboarding();
    await http().post(`/v1/onboardings/${returnOnboardingId}/review/return`).expect(400);
    expect(await readOnboarding(returnOnboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_manual_review',
        current_step: 'awaiting_manual_review',
        completed_at: null,
        context: {},
      }),
    );

    expect(capturedWebhookRequests).toHaveLength(0);

    const approveRows = await readOutboxRowsForOnboarding(approveOnboardingId);
    expect(approveRows).toHaveLength(2);
    expect(approveRows[1]).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(approveRows[1].payload.onboarding).toEqual(
      expect.objectContaining({
        id: approveOnboardingId,
        status: 'approved',
        currentStep: null,
      }),
    );

    const rejectRows = await readOutboxRowsForOnboarding(rejectOnboardingId);
    expect(rejectRows).toHaveLength(2);
    expect(rejectRows[1]).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(rejectRows[1].payload.onboarding).toEqual(
      expect.objectContaining({
        id: rejectOnboardingId,
        status: 'rejected',
        currentStep: null,
      }),
    );

    const invalidRows = await readOutboxRowsForOnboarding(invalidOnboardingId);
    expect(invalidRows).toHaveLength(2);
    expect(invalidRows[1]).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(invalidRows[1].payload.onboarding).toEqual(
      expect.objectContaining({
        id: invalidOnboardingId,
        status: 'invalid',
        currentStep: null,
      }),
    );

    const returnRows = await readOutboxRowsForOnboarding(returnOnboardingId);
    expect(returnRows).toHaveLength(1);
    expect(returnRows[0]).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(returnRows[0].payload.onboarding).toEqual(
      expect.objectContaining({
        id: returnOnboardingId,
        status: 'awaiting_manual_review',
        currentStep: 'awaiting_manual_review',
        completedAt: null,
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
    const unavailableOnboardingId = await startOnboarding();
    await http().post(`/v1/onboardings/${unavailableOnboardingId}/review/return`).expect(400);
    const unavailableRowsBefore = await readOutboxRowsForOnboarding(unavailableOnboardingId);
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
        current_step: 'collect_email',
        completed_at: null,
        context: {},
      }),
    );
    const unavailableRowsAfter = await readOutboxRowsForOnboarding(unavailableOnboardingId);
    expect(unavailableRowsAfter).toHaveLength(unavailableRowsBefore.length + 1);
    const unavailableExceptionRow = unavailableRowsAfter[unavailableRowsAfter.length - 1];
    expect(unavailableExceptionRow).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(unavailableExceptionRow.payload.onboarding).toEqual(
      expect.objectContaining({
        id: unavailableOnboardingId,
        workflowId: 'base',
        workflowVersion: 1,
        status: 'awaiting_user',
        currentStep: 'collect_email',
        completedAt: null,
      }),
    );
    assertMetadataOnlyPayloadShape(unavailableExceptionRow.payload as Record<string, unknown>);
    expect(capturedWebhookRequests).toHaveLength(0);

    await http()
      .post('/v1/onboardings/01900000-0000-7000-8000-000000000000/review/approve')
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });

    const completedApprovedOnboardingId = await startManualReviewOnboarding();
    await http()
      .post(`/v1/onboardings/${completedApprovedOnboardingId}/review/approve`)
      .expect(200);
    const approvedConflictRowsBefore = await readOutboxRowsForOnboarding(
      completedApprovedOnboardingId,
    );
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
    const approvedConflictRowsAfter = await readOutboxRowsForOnboarding(
      completedApprovedOnboardingId,
    );
    expect(approvedConflictRowsAfter).toHaveLength(approvedConflictRowsBefore.length + 1);
    const approvedConflictRow = approvedConflictRowsAfter[approvedConflictRowsAfter.length - 1];
    expect(approvedConflictRow).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(approvedConflictRow.payload.onboarding).toEqual(
      expect.objectContaining({
        id: completedApprovedOnboardingId,
        status: 'approved',
        currentStep: null,
      }),
    );
    assertMetadataOnlyPayloadShape(approvedConflictRow.payload as Record<string, unknown>);
    expect(capturedWebhookRequests).toHaveLength(0);

    const completedRejectedOnboardingId = await startManualReviewOnboarding();
    await http().post(`/v1/onboardings/${completedRejectedOnboardingId}/review/reject`).expect(200);
    const rejectedConflictRowsBefore = await readOutboxRowsForOnboarding(
      completedRejectedOnboardingId,
    );
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
    const rejectedConflictRowsAfter = await readOutboxRowsForOnboarding(
      completedRejectedOnboardingId,
    );
    expect(rejectedConflictRowsAfter).toHaveLength(rejectedConflictRowsBefore.length + 1);
    const rejectedConflictRow = rejectedConflictRowsAfter[rejectedConflictRowsAfter.length - 1];
    expect(rejectedConflictRow).toEqual(
      expect.objectContaining({
        event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpoint_url: `${clientWebhookTestUrl}/notify`,
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        delivered_at: null,
      }),
    );
    expect(rejectedConflictRow.payload.onboarding).toEqual(
      expect.objectContaining({
        id: completedRejectedOnboardingId,
        status: 'rejected',
        currentStep: null,
      }),
    );
    assertMetadataOnlyPayloadShape(rejectedConflictRow.payload as Record<string, unknown>);
    expect(capturedWebhookRequests).toHaveLength(0);
  });

  it('returns UNKNOWN_WORKFLOW_EVALUATION and emits one independent rejected-attempt snapshot row with unchanged state', async () => {
    const onboardingId = await startManualReviewOnboarding();
    const workflow = await pinWorkflowInstance('manual-review', 1);
    const evaluateManualSpy = jest
      .spyOn(workflow, 'evaluateManual')
      .mockReturnValue(WorkflowEvaluationResult.unknownEvaluation());

    try {
      const outboxRowsBefore = await readOutboxRowsForOnboarding(onboardingId);

      const response = await http()
        .post(`/v1/onboardings/${onboardingId}/review/approve`)
        .expect(409);
      expect(response.body).toEqual({
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      });

      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_manual_review',
          current_step: 'awaiting_manual_review',
          completed_at: null,
          context: {},
        }),
      );

      const outboxRowsAfter = await readOutboxRowsForOnboarding(onboardingId);
      expect(outboxRowsAfter).toHaveLength(outboxRowsBefore.length + 1);
      const exceptionRow = outboxRowsAfter[outboxRowsAfter.length - 1];
      expect(exceptionRow).toEqual(
        expect.objectContaining({
          event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
        }),
      );
      expect(exceptionRow.payload.onboarding).toEqual(
        expect.objectContaining({
          id: onboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: 'awaiting_manual_review',
          completedAt: null,
        }),
      );
      assertMetadataOnlyPayloadShape(exceptionRow.payload as Record<string, unknown>);

      expect(capturedWebhookRequests).toHaveLength(0);
    } finally {
      evaluateManualSpy.mockRestore();
    }
  });

  it('keeps submit runtime fault response while emitting one independent rejected-attempt snapshot row from unchanged pre-operation state', async () => {
    const onboardingId = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const firstConnector = getApp().get(MockKyc1Connector);
    const runtimeFailure = new Error('connector runtime failure');
    const executeSpy = jest.spyOn(firstConnector, 'execute').mockRejectedValueOnce(runtimeFailure);

    try {
      const outboxRowsBefore = await readOutboxRowsForOnboarding(onboardingId);

      await http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect(500);

      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'accept_terms',
          context: { email: 'person@example.com' },
          completed_at: null,
        }),
      );

      const outboxRowsAfter = await readOutboxRowsForOnboarding(onboardingId);
      expect(outboxRowsAfter).toHaveLength(outboxRowsBefore.length + 1);
      const exceptionRow = outboxRowsAfter[outboxRowsAfter.length - 1];
      expect(exceptionRow).toEqual(
        expect.objectContaining({
          event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
          endpoint_url: `${clientWebhookTestUrl}/notify`,
          status: WebhookOutboxStatus.PENDING,
          attempts: 0,
          delivered_at: null,
        }),
      );
      expect(exceptionRow.payload.onboarding).toEqual(
        expect.objectContaining({
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
          completedAt: null,
        }),
      );
      assertMetadataOnlyPayloadShape(exceptionRow.payload as Record<string, unknown>);

      expect(capturedWebhookRequests).toHaveLength(0);
    } finally {
      executeSpy.mockRestore();
    }
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
      const manualReviewResponse = await getAllAdminOnboardings('?status=awaiting_manual_review');
      expectSeededAdminOnboardingSummaries(manualReviewResponse, seededIds, [
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

      const rejectedResponse = await getAllAdminOnboardings('?status=rejected');
      expectSeededAdminOnboardingSummaries(rejectedResponse, seededIds, [
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
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { stepId: ['UNKNOWN'] },
      });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        completed_at: null,
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
      rejectionReason: null,
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
        .expect((submitResponse) => expect([200, 201]).toContain(submitResponse.status));

      expect(response.body).toEqual({
        appliedStep: 'collect_identity',
        status: 'invalid',
        currentStep: null,
        rejectionReason: null,
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'invalid',
          current_step: null,
          completed_at: expect.anything(),
          context: {},
        }),
      );
    }
  });

  it('returns retryable INVALID_STEP_DATA while preserving pre-submit context for semantic invalid categories', async () => {
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    const emptyEmail = await startOnboarding();
    await expectRetryableInvalidStepDataWithPreservedState(emptyEmail, {}, { email: ['REQUIRED'] });

    const invalidEmail = await startOnboarding();
    await expectRetryableInvalidStepDataWithPreservedState(
      invalidEmail,
      { email: 'not-an-email' },
      { email: ['INVALID'] },
    );

    const falseConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${falseConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectRetryableInvalidStepDataWithPreservedState(
      falseConsent,
      { acceptedTerms: false },
      { acceptedTerms: ['INVALID'] },
    );

    const missingConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${missingConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectRetryableInvalidStepDataWithPreservedState(
      missingConsent,
      {},
      { acceptedTerms: ['REQUIRED'] },
    );

    const inactiveField = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${inactiveField}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectRetryableInvalidStepDataWithPreservedState(
      inactiveField,
      { email: 'valid@example.com' },
      {
        email: ['UNKNOWN'],
        acceptedTerms: ['REQUIRED'],
      },
    );

    firstExecuteSpy.mockRestore();
    secondExecuteSpy.mockRestore();
  });

  it('returns retryable INVALID_STEP_DATA for wrong primitive input types', async () => {
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    const emailType = await startOnboarding();
    await expectRetryableInvalidStepDataWithPreservedState(
      emailType,
      { email: 123 },
      { email: ['INVALID'] },
    );

    const consentType = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectRetryableInvalidStepDataWithPreservedState(
      consentType,
      { acceptedTerms: 'true' },
      { acceptedTerms: ['INVALID'] },
    );

    firstExecuteSpy.mockRestore();
    secondExecuteSpy.mockRestore();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a JSON string', JSON.stringify('person@example.com')],
    ['a JSON number', '123'],
    ['a JSON boolean', 'true'],
  ])('routes %s submit bodies to retryable INVALID_STEP_DATA', async (_label, body) => {
    const onboardingId = await startOnboarding();

    await expectRetryableInvalidStepDataWithPreservedState(onboardingId, JSON.parse(body), {});
  });

  it('persists terminal invalid with null applied step for missing/unknown active state without leaking reasons', async () => {
    const onboardingId = await startOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;

    await dataSource.query(
      `UPDATE onboardings
       SET current_step = $2, context = $3::jsonb
       WHERE id = $1`,
      [onboardingId, 'missing_step', JSON.stringify({ persisted: 'context-value' })],
    );

    await expectTerminalInvalidWithPreservedContext(
      onboardingId,
      { any: 'input' },
      { persisted: 'context-value' },
      null,
      BASE_TERMINAL_NOTIFY_PATH,
    );
  });

  it('preserves pre-submit context and returns retryable INVALID_STEP_DATA when undeclared fields are submitted', async () => {
    const firstConnector = getApp().get(MockKyc1Connector);
    const secondConnector = getApp().get(MockKyc2Connector);
    const firstExecuteSpy = jest
      .spyOn(firstConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());
    const secondExecuteSpy = jest
      .spyOn(secondConnector, 'execute')
      .mockResolvedValue(ConnectorExecutionResult.accepted());

    const onboardingId = await startOnboarding();

    await expectRetryableInvalidStepDataWithPreservedState(
      onboardingId,
      { email: 'person@example.com', unexpected: 'discard-me' },
      { unexpected: ['UNKNOWN'] },
    );

    firstExecuteSpy.mockRestore();
    secondExecuteSpy.mockRestore();
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
      getApp().get(WebhookService),
      getApp().get(AuditService),
    );

    await expect(
      freshService.submit(onboardingId, { email: 'fresh@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'collect_email',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
      rejectionReason: null,
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
             AND query ILIKE '%FOR NO KEY UPDATE%'
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
        body: {
          code: 'INVALID_STEP_DATA',
          message: 'INVALID_STEP_DATA',
          errors: {
            email: ['UNKNOWN'],
            acceptedTerms: ['REQUIRED'],
          },
        },
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'accept_terms',
          completed_at: null,
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
             AND query ILIKE '%FOR NO KEY UPDATE%'
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
      { name: '0006_create_client_webhook_outbox_1784592000000' },
      { name: '0005_widen_document_size_columns_1784764800000' },
      { name: '0007_add_onboarding_rejection_reason_1784851200000' },
      { name: '0008_update_client_webhook_outbox_delivery_lifecycle_1784937600000' },
      { name: '0009_add_invalid_onboarding_status_1785024000000' },
      { name: '0010_create_audit_log_1785110400000' },
      { name: '0011_add_client_webhook_outbox_retry_policy_2026073100000' },
      { name: '0012_drop_client_webhook_outbox_onboarding_fk_2051222400000' },
      { name: '0013_create_workflows_2051308800000' },
      { name: '0014_add_workflow_status_2051395200000' },
      { name: '0015_add_retired_workflow_status_2051481600000' },
      { name: '0016_create_connector_settings_2051568000000' },
      { name: '0017_rename_connector_settings_to_connectors_2051654400000' },
      { name: '0018_create_connector_applicant_references_2051740800000' },
    ]);

    const tables = await dataSource.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    expect(tables).toEqual([
      { table_name: '_engine_alive' },
      { table_name: 'audit_log' },
      { table_name: 'client_webhook_outbox' },
      { table_name: 'connector_applicant_references' },
      { table_name: 'connectors' },
      { table_name: 'migrations' },
      { table_name: 'onboarding_documents' },
      { table_name: 'onboardings' },
      { table_name: 'workflows' },
    ]);

    const documentTable = await dataSource.query(
      "SELECT to_regclass('onboarding_documents') AS table_name",
    );
    expect(documentTable).toEqual([{ table_name: 'onboarding_documents' }]);
  });

  it('widens onboarding document size columns through guarded down/up cycles', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migration = new WidenDocumentSizeColumns0005();
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
      {
        column_name: 'rejection_reason',
        data_type: 'character varying',
        udt_name: 'varchar',
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
        expect.objectContaining({
          conname: 'chk_onboardings_rejection_reason_terminal',
          definition: expect.stringContaining('rejection_reason IS NULL'),
        }),
      ]),
    );
  });

  it('applies and guards migration 0009 invalid onboarding-status lifecycle checks', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migration = new AddInvalidOnboardingStatus0009();
    const queryRunner = dataSource.createQueryRunner();

    const readConstraintMetadata = async () =>
      dataSource.query(
        `SELECT conname, pg_get_constraintdef(oid) AS definition
         FROM pg_constraint
         WHERE conrelid = 'public.onboardings'::regclass
           AND contype = 'c'
           AND conname IN ('chk_onboardings_status', 'chk_onboardings_lifecycle_state')
         ORDER BY conname`,
      );

    try {
      await queryRunner.connect();

      await expect(readConstraintMetadata()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conname: 'chk_onboardings_status',
            definition: expect.stringContaining("'invalid'"),
          }),
          expect.objectContaining({
            conname: 'chk_onboardings_lifecycle_state',
            definition: expect.stringContaining("'invalid'"),
          }),
        ]),
      );

      const invalidId = randomUUID();
      await expect(
        dataSource.query(
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
            completed_at,
            rejection_reason
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            invalidId,
            'base',
            1,
            'invalid',
            null,
            JSON.stringify({}),
            null,
            new Date(),
            new Date(),
            new Date(),
            null,
          ],
        ),
      ).resolves.toBeDefined();

      await expect(migration.down(queryRunner)).rejects.toThrow(/invalid status/i);

      await dataSource.query(
        'DELETE FROM client_webhook_outbox WHERE onboarding_id IN (SELECT id FROM onboardings WHERE status = $1)',
        ['invalid'],
      );
      await dataSource.query('DELETE FROM onboardings WHERE status = $1', ['invalid']);

      await expect(migration.down(queryRunner)).resolves.toBeUndefined();
      await expect(readConstraintMetadata()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conname: 'chk_onboardings_status',
            definition: expect.not.stringContaining("'invalid'"),
          }),
          expect.objectContaining({
            conname: 'chk_onboardings_lifecycle_state',
            definition: expect.not.stringContaining("'invalid'"),
          }),
        ]),
      );

      await expect(migration.up(queryRunner)).resolves.toBeUndefined();
      await expect(readConstraintMetadata()).resolves.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            conname: 'chk_onboardings_status',
            definition: expect.stringContaining("'invalid'"),
          }),
          expect.objectContaining({
            conname: 'chk_onboardings_lifecycle_state',
            definition: expect.stringContaining("'invalid'"),
          }),
        ]),
      );
    } finally {
      await queryRunner.release();
    }
  });

  it('restores onboarding rejection-reason schema after migration 0007 down/up cycle', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migration = new AddOnboardingRejectionReason0007();
    const queryRunner = dataSource.createQueryRunner();

    const readRejectionReasonColumn = async () =>
      dataSource.query(
        `SELECT column_name, data_type, udt_name, is_nullable
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'onboardings'
           AND column_name = 'rejection_reason'`,
      );

    const readRejectionReasonConstraint = async () =>
      dataSource.query(
        `SELECT conname
         FROM pg_constraint
         WHERE conrelid = 'public.onboardings'::regclass
           AND contype = 'c'
           AND conname = 'chk_onboardings_rejection_reason_terminal'`,
      );

    try {
      await queryRunner.connect();

      await expect(readRejectionReasonColumn()).resolves.toEqual([
        {
          column_name: 'rejection_reason',
          data_type: 'character varying',
          udt_name: 'varchar',
          is_nullable: 'YES',
        },
      ]);
      await expect(readRejectionReasonConstraint()).resolves.toEqual([
        { conname: 'chk_onboardings_rejection_reason_terminal' },
      ]);

      await expect(migration.down(queryRunner)).resolves.toBeUndefined();
      await expect(readRejectionReasonColumn()).resolves.toEqual([]);
      await expect(readRejectionReasonConstraint()).resolves.toEqual([]);

      await expect(migration.up(queryRunner)).resolves.toBeUndefined();
      await expect(readRejectionReasonColumn()).resolves.toEqual([
        {
          column_name: 'rejection_reason',
          data_type: 'character varying',
          udt_name: 'varchar',
          is_nullable: 'YES',
        },
      ]);
      await expect(readRejectionReasonConstraint()).resolves.toEqual([
        { conname: 'chk_onboardings_rejection_reason_terminal' },
      ]);
    } finally {
      await queryRunner.release();
    }
  });

  it('enforces rejection reason terminal vocabulary and status binding', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const insertedIds: string[] = [];

    try {
      const allowedId = randomUUID();
      insertedIds.push(allowedId);

      await expect(
        dataSource.query(
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
            completed_at,
            rejection_reason
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            allowedId,
            'base',
            1,
            'rejected',
            null,
            JSON.stringify({}),
            null,
            new Date(),
            new Date(),
            new Date(),
            null,
          ],
        ),
      ).resolves.toBeDefined();

      await expect(
        dataSource.query(
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
            completed_at,
            rejection_reason
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            'base',
            1,
            'rejected',
            null,
            JSON.stringify({}),
            null,
            new Date(),
            new Date(),
            new Date(),
            'NOT_A_REASON',
          ],
        ),
      ).rejects.toThrow(/chk_onboardings_rejection_reason_terminal/i);

      await expect(
        dataSource.query(
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
            completed_at,
            rejection_reason
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            'base',
            1,
            'awaiting_user',
            'collect_email',
            JSON.stringify({}),
            null,
            new Date(),
            new Date(),
            null,
            'ATTEMPTS_EXHAUSTED',
          ],
        ),
      ).rejects.toThrow(/chk_onboardings_rejection_reason_terminal/i);

      await expect(
        dataSource.query(
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
            completed_at,
            rejection_reason
          ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11)`,
          [
            randomUUID(),
            'base',
            1,
            'approved',
            null,
            JSON.stringify({}),
            null,
            new Date(),
            new Date(),
            new Date(),
            'CHALLENGE_EXPIRED',
          ],
        ),
      ).rejects.toThrow(/chk_onboardings_rejection_reason_terminal/i);
    } finally {
      if (insertedIds.length > 0) {
        await dataSource.query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [insertedIds]);
      }
    }
  });
  it('describes the renderable controls of the current step and activates conditional fields from persisted context', async () => {
    const onboardingId = await startConditionalWorkflowOnboarding();

    const initialState = await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200);

    expect(initialState.body).toEqual({
      onboardingId,
      workflowId: CONDITIONAL_FIELDS_TRANSITIONS_WORKFLOW_ID,
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'collect_country',
      terminal: false,
      rejectionReason: null,
      step: {
        name: 'collect_country',
        status: 'awaiting_user',
        canSubmit: true,
        fields: [
          {
            name: 'country',
            type: 'text',
            required: true,
            active: true,
            dependsOn: [],
            schema: { type: 'string' },
            value: null,
          },
        ],
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: { country: { type: 'string' } },
          required: ['country'],
        },
      },
    });

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ country: 'US' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const conditionalState = await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200);

    expect(conditionalState.body.currentStep).toBe('collect_details');
    expect(conditionalState.body.step.fields).toEqual([
      {
        name: 'taxId',
        type: 'text',
        required: true,
        active: true,
        dependsOn: ['country'],
        when: { field: 'country', equals: 'US' },
        schema: { type: 'string' },
        value: null,
      },
      {
        name: 'currentOnly',
        type: 'text',
        required: true,
        active: true,
        dependsOn: ['country'],
        when: { field: 'country', equals: 'US' },
        schema: { type: 'string' },
        value: null,
      },
    ]);
    expect(conditionalState.body.step.schema).toEqual({
      type: 'object',
      additionalProperties: false,
      properties: { taxId: { type: 'string' }, currentOnly: { type: 'string' } },
      required: ['taxId', 'currentOnly'],
    });
  });

  it('exposes file upload constraints for the current step and prefills persisted values', async () => {
    const start = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'file-upload' })
      .expect(201);
    const onboardingId = start.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);

    const state = await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200);

    expect(state.body.step).toEqual({
      name: 'collect_identity',
      status: 'awaiting_user',
      canSubmit: true,
      fields: [
        {
          name: 'identityDocument',
          type: 'file',
          required: true,
          active: true,
          dependsOn: [],
          schema: { type: 'string', minLength: 1 },
          value: null,
          upload: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 5242880,
            maxImageWidth: 4096,
            maxImageHeight: 4096,
          },
        },
        {
          name: 'documentLabel',
          type: 'text',
          required: true,
          active: true,
          dependsOn: [],
          schema: { type: 'string', minLength: 1 },
          value: null,
        },
      ],
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          identityDocument: { type: 'string', minLength: 1 },
          documentLabel: { type: 'string', minLength: 1 },
        },
        required: ['identityDocument', 'documentLabel'],
      },
    });
  });

  it('reports a terminal onboarding without controls to render', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'state-terminal@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    await http().get(`/v1/onboardings/${onboardingId}/state`).expect(200).expect({
      onboardingId,
      workflowId: 'base',
      workflowVersion: 1,
      status: 'approved',
      currentStep: null,
      terminal: true,
      rejectionReason: null,
      step: null,
    });
  });

  it('returns the stable not-found response for the state of an unknown onboarding', async () => {
    await http()
      .get(`/v1/onboardings/${randomUUID()}/state`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
  });
});
