import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createServer, IncomingMessage, Server } from 'node:http';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MockEmailOtpConnector } from '../src/connectors/adapters/mock-email-otp.connector';
import { AuditService } from '../src/audit/audit.service';
import { WebhookRepository } from '../src/webhook/webhook.repository';
import { WorkflowEvaluationResult } from '../src/workflows/domain/workflow';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';
import * as uuidUtil from '../src/utils/uuid.util';

jest.setTimeout(120000);

type AuditLogRow = {
  id: string;
  occurred_at: string;
  actor_type: string;
  actor_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  hash_prev: string | null;
  hash_self: string | null;
};

type AuditLogIndexRow = {
  indexname: string;
  indexdef: string;
};

type AuditLogColumnRow = {
  column_name: string;
  udt_name: string;
  is_nullable: 'YES' | 'NO';
};

let app: NestExpressApplication | null = null;
let webhookServer: Server | null = null;
let webhookResponseMode: 'success' | 'failure' = 'success';

const createdOnboardingIds = new Set<string>();
const createdAuditIds = new Set<string>();

const readRawRequestBody = async (request: IncomingMessage): Promise<void> => {
  for await (const chunk of request) {
    void chunk;
  }
};

const startLocalWebhookServer = async (): Promise<string> =>
  new Promise((resolve, reject) => {
    webhookServer = createServer((request, response) => {
      void readRawRequestBody(request).finally(() => {
        if (webhookResponseMode === 'failure') {
          response.statusCode = 503;
          response.end('client webhook unavailable');
          return;
        }

        response.statusCode = 204;
        response.end();
      });
    });

    webhookServer.once('error', reject);
    webhookServer.listen(0, '127.0.0.1', () => {
      const address = webhookServer?.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Unable to resolve local webhook server address'));
        return;
      }

      resolve(`http://127.0.0.1:${address.port}/client-webhook`);
    });
  });

const closeLocalWebhookServer = async () => {
  if (!webhookServer?.listening) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    webhookServer?.close((error) => {
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

const dataSource = (): DataSource => getApp().get(DataSource);

const seedAcceptedSubmitOnboarding = async (): Promise<string> => {
  const onboardingId = randomUUID();
  const email = `audit-${onboardingId.replace(/-/g, '')}@example.com`;

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
      onboardingId,
      'base',
      1,
      'awaiting_user',
      'accept_terms',
      JSON.stringify({ email }),
      null,
      null,
    ],
  );

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const seedManualReviewOnboarding = async (): Promise<string> => {
  const onboardingId = randomUUID();

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
      onboardingId,
      'manual-review',
      1,
      'awaiting_manual_review',
      'awaiting_manual_review',
      JSON.stringify({}),
      null,
      null,
    ],
  );

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const seedAuditRows = async (
  rows: Array<{
    id: string;
    occurredAt: string;
    actorType: string;
    actorId: string;
    action: string;
    resourceType: string;
    resourceId: string;
    metadata: Record<string, unknown>;
  }>,
) => {
  const insertedIds: string[] = [];

  for (const row of rows) {
    const id = row.id;
    await dataSource().query(
      `INSERT INTO audit_log (
        id,
        occurred_at,
        actor_type,
        actor_id,
        action,
        resource_type,
        resource_id,
        before,
        after,
        metadata,
        hash_prev,
        hash_self
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)`,
      [
        id,
        row.occurredAt,
        row.actorType,
        row.actorId,
        row.action,
        row.resourceType,
        row.resourceId,
        null,
        null,
        JSON.stringify(row.metadata),
        null,
        null,
      ],
    );
    createdAuditIds.add(id);
    insertedIds.push(id);
  }

  return insertedIds;
};

const readAuditRows = async (resourceId: string): Promise<AuditLogRow[]> => {
  return dataSource().query(
    `SELECT
      id,
      occurred_at,
      actor_type,
      actor_id,
      action,
      resource_type,
      resource_id,
      before,
      after,
      metadata,
      hash_prev,
      hash_self
     FROM audit_log
     WHERE resource_type = 'onboarding' AND resource_id = $1
     ORDER BY occurred_at DESC, id DESC`,
    [resourceId],
  );
};

const readOutboxRows = async (onboardingId: string) => {
  return dataSource().query(
    `SELECT id, onboarding_id, event_type, endpoint_url, payload, status, attempts, delivered_at
     FROM client_webhook_outbox
     WHERE onboarding_id = $1
     ORDER BY created_at ASC, id ASC`,
    [onboardingId],
  );
};

const readOnboardingRows = async (onboardingId: string) => {
  return dataSource().query(
    `SELECT id, workflow_id, workflow_version, status, current_step, context, completed_at
     FROM onboardings
     WHERE id = $1`,
    [onboardingId],
  );
};

type LifecycleAuditExpectation = {
  action: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
};

const startWorkflowOnboarding = async (
  workflowId: 'base' | 'email-otp' | 'manual-review',
  expectedCurrentStep: string,
  expectedStatus: 'awaiting_user' | 'awaiting_manual_review',
) => {
  const response = await request(getApp().getHttpServer())
    .post('/v1/onboardings')
    .send({ workflowId })
    .expect(201);

  expect(response.body).toEqual({
    onboardingId: expect.any(String),
    status: expectedStatus,
    currentStep: expectedCurrentStep,
    expiresAt: null,
  });

  const onboardingId = response.body.onboardingId as string;
  expect(onboardingId).not.toHaveLength(0);

  expect(await readOnboardingRows(onboardingId)).toEqual([
    expect.objectContaining({
      workflow_id: workflowId,
      workflow_version: 1,
      status: expectedStatus,
      current_step: expectedCurrentStep,
      context: {},
      completed_at: null,
    }),
  ]);

  createdOnboardingIds.add(onboardingId);
  return onboardingId;
};

const expectLifecycleAuditRows = async (
  resourceId: string,
  expectedRows: LifecycleAuditExpectation[],
  options?: { lifecycleOnly?: boolean },
) => {
  const allAuditRows = (await readAuditRows(resourceId)) as AuditLogRow[];
  const auditRows = options?.lifecycleOnly
    ? allAuditRows.filter((row) => row.action !== 'onboarding.rejected_attempt')
    : allAuditRows;

  expect(auditRows).toHaveLength(expectedRows.length);

  expectedRows.forEach((expectedRow, index) => {
    const actualRow = auditRows[index];

    expect(actualRow).toEqual(
      expect.objectContaining({
        actor_type: 'system',
        actor_id: 'engine',
        action: expectedRow.action,
        resource_type: 'onboarding',
        resource_id: resourceId,
        before: expectedRow.before,
        after: expectedRow.after,
        metadata: expectedRow.metadata,
        hash_prev: null,
        hash_self: null,
      }),
    );
    expect(Object.keys(actualRow.metadata).sort()).toEqual(
      Object.keys(expectedRow.metadata).sort(),
    );
  });
};

const expectLatestRejectedAttemptAuditRow = async (
  resourceId: string,
  expected: {
    operation: 'submit' | 'manual_review';
    outcome:
      | 'onboarding_not_found'
      | 'onboarding_completed'
      | 'retryable_invalid_data'
      | 'unknown_workflow_evaluation'
      | 'unsupported_action'
      | 'transition_unavailable';
  },
) => {
  const auditRows = (await readAuditRows(resourceId)) as AuditLogRow[];
  const latestRow = auditRows.find((row) => row.action === 'onboarding.rejected_attempt');

  expect(latestRow).toEqual(
    expect.objectContaining({
      actor_type: 'system',
      actor_id: 'engine',
      action: 'onboarding.rejected_attempt',
      resource_type: 'onboarding',
      resource_id: resourceId,
      before: null,
      after: null,
      hash_prev: null,
      hash_self: null,
      metadata: {
        operation: expected.operation,
        outcome: expected.outcome,
      },
    }),
  );
  expect(latestRow).toBeDefined();
  expect(Object.keys(latestRow!.metadata).sort()).toEqual(['operation', 'outcome']);

  return auditRows;
};

const cleanupCreatedRows = async () => {
  const onboardingIds = Array.from(createdOnboardingIds);

  if (app) {
    const auditIds = Array.from(createdAuditIds);

    if (auditIds.length > 0) {
      await dataSource().query('DELETE FROM audit_log WHERE id = ANY($1::uuid[])', [auditIds]);
    }

    if (onboardingIds.length > 0) {
      await dataSource().query(
        'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
        [onboardingIds],
      );
      await dataSource().query(
        'DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])',
        ['onboarding', onboardingIds],
      );
      await dataSource().query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
        onboardingIds,
      ]);
    }
  }

  createdOnboardingIds.clear();
  createdAuditIds.clear();
};

describe('Audit transaction slice (e2e)', () => {
  beforeAll(async () => {
    const webhookBaseUrl = await startLocalWebhookServer();

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
    process.env.CLIENT_WEBHOOK_BASE_URL = webhookBaseUrl;
    process.env.CLIENT_WEBHOOK_TIMEOUT_MS = '150';
    process.env.WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', 'workflows');
    process.env.AUDIT_ADMIN_API_KEY = 'audit-admin-key';
    process.env.AUDIT_NON_ADMIN_API_KEY = 'audit-non-admin-key';

    const { createApp } = await import('../src/main');

    const appBundle = await createApp();
    app = appBundle.app;
    await app.init();
  });

  afterEach(async () => {
    webhookResponseMode = 'success';
    await cleanupCreatedRows();
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await cleanupCreatedRows();
    await closeLocalWebhookServer();
    await app?.close();
  });

  it('shows the audit_log schema and exactly the two explicit secondary indexes', async () => {
    const tableRows = (await dataSource().query(
      `SELECT to_regclass('public.audit_log') AS table_name`,
    )) as Array<{ table_name: string | null }>;
    expect(tableRows[0].table_name).toBe('audit_log');

    const columnRows = (await dataSource().query(
      `SELECT column_name, udt_name, is_nullable
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'audit_log'
       ORDER BY ordinal_position`,
    )) as AuditLogColumnRow[];

    expect(columnRows).toEqual([
      { column_name: 'id', udt_name: 'uuid', is_nullable: 'NO' },
      { column_name: 'occurred_at', udt_name: 'timestamptz', is_nullable: 'NO' },
      { column_name: 'actor_type', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'actor_id', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'action', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'resource_type', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'resource_id', udt_name: 'varchar', is_nullable: 'NO' },
      { column_name: 'before', udt_name: 'jsonb', is_nullable: 'YES' },
      { column_name: 'after', udt_name: 'jsonb', is_nullable: 'YES' },
      { column_name: 'metadata', udt_name: 'jsonb', is_nullable: 'NO' },
      { column_name: 'hash_prev', udt_name: 'varchar', is_nullable: 'YES' },
      { column_name: 'hash_self', udt_name: 'varchar', is_nullable: 'YES' },
    ]);

    const pkeyRows = (await dataSource().query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND indexname = 'audit_log_pkey'`,
    )) as AuditLogIndexRow[];

    expect(pkeyRows).toEqual([
      expect.objectContaining({
        indexname: 'audit_log_pkey',
        indexdef: expect.stringContaining('(id)'),
      }),
    ]);

    const explicitIndexRows = (await dataSource().query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'audit_log' AND indexname <> 'audit_log_pkey'
       ORDER BY indexname`,
    )) as AuditLogIndexRow[];

    expect(explicitIndexRows).toHaveLength(2);
    expect(explicitIndexRows).toEqual([
      expect.objectContaining({
        indexname: 'idx_audit_log_occurred_at',
        indexdef: expect.stringContaining('(occurred_at)'),
      }),
      expect.objectContaining({
        indexname: 'idx_audit_log_resource_type_resource_id',
        indexdef: expect.stringContaining('(resource_type, resource_id)'),
      }),
    ]);
  });

  it('persists one accepted-submit audit row with approved metadata and before/after snapshots when the transaction succeeds', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(response.body).toEqual({
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    const auditRows = (await readAuditRows(onboardingId)) as AuditLogRow[];
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]).toEqual(
      expect.objectContaining({
        actor_type: 'system',
        actor_id: 'engine',
        action: 'onboarding.state_transition',
        resource_type: 'onboarding',
        resource_id: onboardingId,
        before: {
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
        },
        after: {
          id: onboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
        },
        hash_prev: null,
        hash_self: null,
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
        },
      }),
    );

    const outboxRows = await readOutboxRows(onboardingId);
    expect(outboxRows).toHaveLength(1);
    expect(outboxRows[0]).toEqual(
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'DELIVERED',
        attempts: 1,
        delivered_at: expect.any(Date),
      }),
    );
  });

  it('covers the lifecycle audit matrix and rejected-attempt mappings across real routes', async () => {
    const baseInitialStep = 'collect_email';
    const acceptTermsStep = 'accept_terms';
    const manualReviewStep = 'awaiting_manual_review';

    const startOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await expectLifecycleAuditRows(startOnboardingId, [
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: startOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
        },
      },
    ]);

    const intermediateOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const intermediateResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${intermediateOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(intermediateResponse.body).toEqual({
      appliedStep: baseInitialStep,
      status: 'awaiting_user',
      currentStep: acceptTermsStep,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(intermediateOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        after: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: intermediateOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
        },
      },
    ]);

    const approvedOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${approvedOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const approvedResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${approvedOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(approvedResponse.body).toEqual({
      appliedStep: acceptTermsStep,
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(approvedOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
        },
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: acceptTermsStep,
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: acceptTermsStep,
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.state_transition',
        before: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: approvedOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
        },
      },
    ]);

    const rejectedOnboardingId = await startWorkflowOnboarding(
      'email-otp',
      'request_code',
      'awaiting_user',
    );
    const emailOtpConnectorForRejected = getApp().get(MockEmailOtpConnector);
    emailOtpConnectorForRejected.__resetForTests();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const rejectedRowsBaseline = await readAuditRows(rejectedOnboardingId);

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ verificationCode: '111111' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      });

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ verificationCode: '222222' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      });

    const rejectedResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${rejectedOnboardingId}/submit`)
      .send({ verificationCode: '333333' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(rejectedResponse.body).toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'ATTEMPTS_EXHAUSTED',
    });

    const rejectedRowsAfterAllAttempts = (await readAuditRows(
      rejectedOnboardingId,
    )) as AuditLogRow[];
    const retryableInvalidAttemptRows = rejectedRowsAfterAllAttempts.filter(
      (row) =>
        row.action === 'onboarding.rejected_attempt' &&
        row.metadata.operation === 'submit' &&
        row.metadata.outcome === 'retryable_invalid_data',
    );

    expect(rejectedRowsAfterAllAttempts).toHaveLength(rejectedRowsBaseline.length + 3);
    expect(retryableInvalidAttemptRows).toHaveLength(2);

    await expectLifecycleAuditRows(
      rejectedOnboardingId,
      [
        {
          action: 'onboarding.state_transition',
          before: {
            id: rejectedOnboardingId,
            workflowId: 'email-otp',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'verify_code',
          },
          after: {
            id: rejectedOnboardingId,
            workflowId: 'email-otp',
            workflowVersion: 1,
            status: 'rejected',
            currentStep: null,
          },
          metadata: {
            workflowId: 'email-otp',
            workflowVersion: 1,
            appliedStep: 'verify_code',
            fromStatus: 'awaiting_user',
            toStatus: 'rejected',
            fromCurrentStep: 'verify_code',
            toCurrentStep: null,
          },
        },
        {
          action: 'onboarding.state_transition',
          before: {
            id: rejectedOnboardingId,
            workflowId: 'email-otp',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'request_code',
          },
          after: {
            id: rejectedOnboardingId,
            workflowId: 'email-otp',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'verify_code',
          },
          metadata: {
            workflowId: 'email-otp',
            workflowVersion: 1,
            appliedStep: 'request_code',
            fromStatus: 'awaiting_user',
            toStatus: 'awaiting_user',
            fromCurrentStep: 'request_code',
            toCurrentStep: 'verify_code',
          },
        },
        {
          action: 'onboarding.started',
          before: null,
          after: {
            id: rejectedOnboardingId,
            workflowId: 'email-otp',
            workflowVersion: 1,
            status: 'awaiting_user',
            currentStep: 'request_code',
          },
          metadata: {
            workflowId: 'email-otp',
            workflowVersion: 1,
            appliedStep: null,
            fromStatus: null,
            fromCurrentStep: null,
            toStatus: 'awaiting_user',
            toCurrentStep: 'request_code',
          },
        },
      ],
      { lifecycleOnly: true },
    );

    const terminalInvalidOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await dataSource().query(
      `UPDATE onboardings
       SET current_step = $2
       WHERE id = $1`,
      [terminalInvalidOnboardingId, 'missing_step'],
    );
    const terminalInvalidResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${terminalInvalidOnboardingId}/submit`)
      .send({ email: 'not-an-email' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(terminalInvalidResponse.body).toEqual({
      appliedStep: null,
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(terminalInvalidOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: 'missing_step',
        },
        after: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'invalid',
          currentStep: null,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: 'awaiting_user',
          toStatus: 'invalid',
          fromCurrentStep: 'missing_step',
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: terminalInvalidOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
        },
      },
    ]);

    const manualApprovedOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualApprovedOnboardingId}/review/approve`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'approved', currentStep: null });

    await expectLifecycleAuditRows(manualApprovedOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        after: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.approve',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'approved',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualApprovedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
        },
      },
    ]);

    const manualRejectedOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualRejectedOnboardingId}/review/reject`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'rejected', currentStep: null });

    await expectLifecycleAuditRows(manualRejectedOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        after: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'rejected',
          currentStep: null,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.reject',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'rejected',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualRejectedOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
        },
      },
    ]);

    const manualInvalidOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${manualInvalidOnboardingId}/review/invalid`)
      .expect(200)
      .expect({ appliedStep: manualReviewStep, status: 'invalid', currentStep: null });

    await expectLifecycleAuditRows(manualInvalidOnboardingId, [
      {
        action: 'onboarding.manual_review_decision',
        before: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        after: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'invalid',
          currentStep: null,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          manualTrigger: 'manual.invalid',
          appliedStep: manualReviewStep,
          fromStatus: 'awaiting_manual_review',
          toStatus: 'invalid',
          fromCurrentStep: manualReviewStep,
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: manualInvalidOnboardingId,
          workflowId: 'manual-review',
          workflowVersion: 1,
          status: 'awaiting_manual_review',
          currentStep: manualReviewStep,
        },
        metadata: {
          workflowId: 'manual-review',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_manual_review',
          toCurrentStep: manualReviewStep,
        },
      },
    ]);

    const retryableInvalidOnboardingId = await startWorkflowOnboarding(
      'email-otp',
      'request_code',
      'awaiting_user',
    );
    const emailOtpConnectorForRetryableInvalid = getApp().get(MockEmailOtpConnector);
    emailOtpConnectorForRetryableInvalid.__resetForTests();

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${retryableInvalidOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const retryableRowsBefore = await readAuditRows(retryableInvalidOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${retryableInvalidOnboardingId}/submit`)
      .send({ verificationCode: '000000' })
      .expect(400)
      .expect({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      });
    const retryableRowsAfter = await expectLatestRejectedAttemptAuditRow(
      retryableInvalidOnboardingId,
      {
        operation: 'submit',
        outcome: 'retryable_invalid_data',
      },
    );
    expect(retryableRowsAfter).toHaveLength(retryableRowsBefore.length + 1);

    const workflowRegistryService = getApp().get(WorkflowRegistryService);

    const submitUnknownEvaluationOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const submitUnknownWorkflow = workflowRegistryService.getById('base', 1);
    const evaluateSpy = jest
      .spyOn(submitUnknownWorkflow, 'evaluate')
      .mockResolvedValue(WorkflowEvaluationResult.unknownEvaluation());

    try {
      const submitUnknownRowsBefore = await readAuditRows(submitUnknownEvaluationOnboardingId);

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${submitUnknownEvaluationOnboardingId}/submit`)
        .send({ email: 'person@example.com' })
        .expect(409)
        .expect({ code: 'UNKNOWN_WORKFLOW_EVALUATION', message: 'UNKNOWN_WORKFLOW_EVALUATION' });

      const submitUnknownRowsAfter = await expectLatestRejectedAttemptAuditRow(
        submitUnknownEvaluationOnboardingId,
        {
          operation: 'submit',
          outcome: 'unknown_workflow_evaluation',
        },
      );
      expect(submitUnknownRowsAfter).toHaveLength(submitUnknownRowsBefore.length + 1);
    } finally {
      evaluateSpy.mockRestore();
    }

    const submitCompletedConflictOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const submitCompletedRowsBefore = await readAuditRows(submitCompletedConflictOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${submitCompletedConflictOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    const submitCompletedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      submitCompletedConflictOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_completed',
      },
    );
    expect(submitCompletedRowsAfter).toHaveLength(submitCompletedRowsBefore.length + 1);

    const missingSubmitOnboardingId = '01900000-0000-7000-8000-000000000011';
    const missingSubmitRowsBefore = await readAuditRows(missingSubmitOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${missingSubmitOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const missingSubmitRowsAfterFirstAttempt = await expectLatestRejectedAttemptAuditRow(
      missingSubmitOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_not_found',
      },
    );
    expect(missingSubmitRowsAfterFirstAttempt).toHaveLength(missingSubmitRowsBefore.length + 1);

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${missingSubmitOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const missingSubmitRowsAfterSecondAttempt = await expectLatestRejectedAttemptAuditRow(
      missingSubmitOnboardingId,
      {
        operation: 'submit',
        outcome: 'onboarding_not_found',
      },
    );
    expect(missingSubmitRowsAfterSecondAttempt).toHaveLength(missingSubmitRowsBefore.length + 2);

    const unknownEvaluationOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    const unknownEvaluationWorkflow = workflowRegistryService.getById('manual-review', 1);
    const evaluateManualSpy = jest
      .spyOn(unknownEvaluationWorkflow, 'evaluateManual')
      .mockReturnValue(WorkflowEvaluationResult.unknownEvaluation());

    try {
      const unknownRowsBefore = await readAuditRows(unknownEvaluationOnboardingId);

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${unknownEvaluationOnboardingId}/review/approve`)
        .expect(409)
        .expect({ code: 'UNKNOWN_WORKFLOW_EVALUATION', message: 'UNKNOWN_WORKFLOW_EVALUATION' });

      const unknownRowsAfter = await expectLatestRejectedAttemptAuditRow(
        unknownEvaluationOnboardingId,
        {
          operation: 'manual_review',
          outcome: 'unknown_workflow_evaluation',
        },
      );
      expect(unknownRowsAfter).toHaveLength(unknownRowsBefore.length + 1);
    } finally {
      evaluateManualSpy.mockRestore();
    }

    const unsupportedManualTransitionOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unsupportedManualTransitionOnboardingId}/review/return`)
      .expect(400)
      .expect({
        message: ['action must be one of the following values: approve, reject, invalid'],
        error: 'Bad Request',
        statusCode: 400,
      });

    const unavailableManualTransitionOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    const unavailableRowsBefore = await readAuditRows(unavailableManualTransitionOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unavailableManualTransitionOnboardingId}/review/approve`)
      .expect(409)
      .expect({
        code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
        message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      });
    const unavailableRowsAfter = await expectLatestRejectedAttemptAuditRow(
      unavailableManualTransitionOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'transition_unavailable',
      },
    );
    expect(unavailableRowsAfter).toHaveLength(unavailableRowsBefore.length + 1);

    const completedConflictOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      manualReviewStep,
      'awaiting_manual_review',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${completedConflictOnboardingId}/review/approve`)
      .expect(200);

    const completedRowsBefore = await readAuditRows(completedConflictOnboardingId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${completedConflictOnboardingId}/review/reject`)
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    const completedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      completedConflictOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'onboarding_completed',
      },
    );
    expect(completedRowsAfter).toHaveLength(completedRowsBefore.length + 1);

    const notFoundResourceId = '01900000-0000-7000-8000-000000000000';
    const notFoundRowsBefore = await readAuditRows(notFoundResourceId);
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notFoundResourceId}/review/approve`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    const notFoundRowsAfter = await expectLatestRejectedAttemptAuditRow(notFoundResourceId, {
      operation: 'manual_review',
      outcome: 'onboarding_not_found',
    });
    expect(notFoundRowsAfter).toHaveLength(notFoundRowsBefore.length + 1);

    const notificationFailureOnboardingId = await startWorkflowOnboarding(
      'base',
      baseInitialStep,
      'awaiting_user',
    );
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notificationFailureOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const notificationFailureRowsBefore = await readAuditRows(notificationFailureOnboardingId);
    webhookResponseMode = 'failure';

    const notificationFailureResponse = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${notificationFailureOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(notificationFailureResponse.body).toEqual({
      appliedStep: acceptTermsStep,
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    await expectLifecycleAuditRows(notificationFailureOnboardingId, [
      {
        action: 'onboarding.state_transition',
        before: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
        },
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'approved',
          currentStep: null,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: acceptTermsStep,
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: acceptTermsStep,
          toCurrentStep: null,
        },
      },
      {
        action: 'onboarding.state_transition',
        before: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: acceptTermsStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: baseInitialStep,
          fromStatus: 'awaiting_user',
          toStatus: 'awaiting_user',
          fromCurrentStep: baseInitialStep,
          toCurrentStep: acceptTermsStep,
        },
      },
      {
        action: 'onboarding.started',
        before: null,
        after: {
          id: notificationFailureOnboardingId,
          workflowId: 'base',
          workflowVersion: 1,
          status: 'awaiting_user',
          currentStep: baseInitialStep,
        },
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: null,
          fromStatus: null,
          fromCurrentStep: null,
          toStatus: 'awaiting_user',
          toCurrentStep: baseInitialStep,
        },
      },
    ]);

    expect(await readAuditRows(notificationFailureOnboardingId)).toHaveLength(
      notificationFailureRowsBefore.length + 1,
    );
  });

  it('persists onboarding.rejected_attempt for unsupported manual review actions', async () => {
    const unsupportedManualTransitionOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      'awaiting_manual_review',
      'awaiting_manual_review',
    );
    const unsupportedRowsBefore = await readAuditRows(unsupportedManualTransitionOnboardingId);

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${unsupportedManualTransitionOnboardingId}/review/return`)
      .expect(400)
      .expect({
        message: ['action must be one of the following values: approve, reject, invalid'],
        error: 'Bad Request',
        statusCode: 400,
      });

    const unsupportedRowsAfter = await expectLatestRejectedAttemptAuditRow(
      unsupportedManualTransitionOnboardingId,
      {
        operation: 'manual_review',
        outcome: 'unsupported_action',
      },
    );
    expect(unsupportedRowsAfter).toHaveLength(unsupportedRowsBefore.length + 1);
  });

  it('returns 401 for missing or malformed bearer auth and 403 for valid non-admin scope on the audit read route', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .expect(401)
      .expect((result) => {
        expect(result.body).toEqual(
          expect.objectContaining({
            code: 'UNAUTHORIZED',
            message: 'UNAUTHORIZED',
          }),
        );
      });

    await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', 'Basic abc')
      .expect(401)
      .expect((result) => {
        expect(result.body).toEqual(
          expect.objectContaining({
            code: 'UNAUTHORIZED',
            message: 'UNAUTHORIZED',
          }),
        );
      });

    await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', 'Bearer audit-non-admin-key')
      .expect(403)
      .expect((result) => {
        expect(result.body).toEqual(
          expect.objectContaining({
            code: 'FORBIDDEN_SCOPE',
            message: 'FORBIDDEN_SCOPE',
          }),
        );
      });

    await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', 'Bearer audit-admin-key')
      .expect(200)
      .expect((result) => {
        expect(result.body).toEqual({
          items: expect.any(Array),
        });
      });
  });

  it('returns the allowlisted audit event projection with deterministic ordering and no sensitive fields', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const secondOnboardingId = await seedAcceptedSubmitOnboarding();
    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${secondOnboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    const response = await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', 'Bearer audit-admin-key')
      .expect(200);

    expect(response.body).toEqual({
      items: expect.any(Array),
    });

    const items = response.body.items as Array<Record<string, unknown>>;
    const ownedResourceIds = new Set([onboardingId, secondOnboardingId]);
    const testOwnedItems = items.filter(
      (item) =>
        item.resourceType === 'onboarding' && ownedResourceIds.has(item.resourceId as string),
    );

    expect(testOwnedItems).toHaveLength(2);
    expect(testOwnedItems[0]).toEqual(
      expect.objectContaining({
        id: expect.any(String),
        occurredAt: expect.any(String),
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: secondOnboardingId,
        metadata: {
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
        },
      }),
    );
    expect(testOwnedItems[0]).not.toHaveProperty('before');
    expect(testOwnedItems[0]).not.toHaveProperty('after');
    expect(testOwnedItems[0]).not.toHaveProperty('hashPrev');
    expect(testOwnedItems[0]).not.toHaveProperty('hashSelf');
    expect(testOwnedItems[0]).not.toHaveProperty('context');
    expect(testOwnedItems[0]).not.toHaveProperty('submittedData');
    expect(testOwnedItems[0]).not.toHaveProperty('secret');
    expect(testOwnedItems[0]).not.toHaveProperty('otp');
    expect(testOwnedItems[0]).not.toHaveProperty('pii');
    expect(testOwnedItems[0]).toEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({
          workflowId: 'base',
          workflowVersion: 1,
          appliedStep: 'accept_terms',
          fromStatus: 'awaiting_user',
          toStatus: 'approved',
          fromCurrentStep: 'accept_terms',
          toCurrentStep: null,
        }),
      }),
    );
    expect(testOwnedItems[1].resourceId).toBe(onboardingId);
  });

  it('filters by exact predicates, inclusive date bounds, and stable tie ordering', async () => {
    await seedAuditRows([
      {
        id: '01912345-6789-7abc-8def-0123456789aa',
        occurredAt: '2026-07-20T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-1',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ab',
        occurredAt: '2026-07-21T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-2',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ac',
        occurredAt: '2026-07-21T12:00:00.000Z',
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        resourceId: 'resource-3',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
      {
        id: '01912345-6789-7abc-8def-0123456789ad',
        occurredAt: '2026-07-22T12:00:00.000Z',
        actorType: 'system',
        actorId: 'reviewer',
        action: 'manualReview',
        resourceType: 'onboarding',
        resourceId: 'resource-4',
        metadata: { workflowId: 'base', workflowVersion: 1 },
      },
    ]);

    const response = await request(getApp().getHttpServer())
      .get('/v1/admin/audit')
      .query({
        actorType: 'system',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        occurredFrom: '2026-07-20T00:00:00.000Z',
        occurredTo: '2026-07-21T23:59:59.000Z',
      })
      .set('Authorization', 'Bearer audit-admin-key')
      .expect(200);

    expect(response.body.items.map((item: Record<string, unknown>) => item.resourceId)).toEqual([
      'resource-3',
      'resource-2',
      'resource-1',
    ]);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        actorType: 'system',
        action: 'onboarding.state_transition',
        resourceType: 'onboarding',
        metadata: expect.objectContaining({ workflowId: 'base' }),
      }),
    );
    expect(response.body.items[0]).not.toHaveProperty('before');
    expect(response.body.items[0]).not.toHaveProperty('hashPrev');
  });

  it('suppresses isolated rejected-attempt audit insertion failures and preserves original domain responses', async () => {
    const auditService = getApp().get(AuditService);
    const submitMissingOnboardingId = '01900000-0000-7000-8000-000000000012';
    const manualReviewOnboardingId = await startWorkflowOnboarding(
      'manual-review',
      'awaiting_manual_review',
      'awaiting_manual_review',
    );

    const workflowRegistryService = getApp().get(WorkflowRegistryService);
    const manualWorkflow = workflowRegistryService.getById('manual-review', 1);
    const evaluateManualSpy = jest
      .spyOn(manualWorkflow, 'evaluateManual')
      .mockReturnValue(WorkflowEvaluationResult.unknownEvaluation());

    jest
      .spyOn(auditService, 'logRejectedAttempt')
      .mockRejectedValueOnce(new Error('submit rejected-attempt insert failed'))
      .mockRejectedValueOnce(new Error('manual rejected-attempt insert failed'));

    try {
      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${submitMissingOnboardingId}/submit`)
        .send({ acceptedTerms: true })
        .expect(404)
        .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });

      await request(getApp().getHttpServer())
        .post(`/v1/onboardings/${manualReviewOnboardingId}/review/approve`)
        .expect(409)
        .expect({ code: 'UNKNOWN_WORKFLOW_EVALUATION', message: 'UNKNOWN_WORKFLOW_EVALUATION' });

      expect((await readAuditRows(submitMissingOnboardingId)) as AuditLogRow[]).toHaveLength(0);

      const manualRows = (await readAuditRows(manualReviewOnboardingId)) as AuditLogRow[];
      expect(manualRows).toHaveLength(1);
      expect(manualRows[0].action).toBe('onboarding.started');
    } finally {
      evaluateManualSpy.mockRestore();
    }
  });

  it('rejects invalid, blank, overlong, repeated, and reversed audit query values with 400', async () => {
    const invalidCases = [
      { actorType: '   ' },
      { actorType: 'a'.repeat(65) },
      { actorType: ['system', 'engine'] },
      { occurredFrom: 'not-a-date' },
      { occurredFrom: '2026-07-20' },
      { occurredFrom: '2026-07-22T00:00:00.000Z', occurredTo: '2026-07-21T00:00:00.000Z' },
    ];

    for (const query of invalidCases) {
      await request(getApp().getHttpServer())
        .get('/v1/admin/audit')
        .query(query)
        .set('Authorization', 'Bearer audit-admin-key')
        .expect(400);
    }
  });

  it('rolls back onboarding, outbox, and audit rows when the start audit insert fails', async () => {
    const onboardingId = '01900000-0000-7000-8000-000000000001';
    const auditService = getApp().get(AuditService);

    jest.spyOn(uuidUtil, 'generateUuidV7').mockReturnValueOnce(onboardingId);
    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('start audit insert failed'));

    await request(getApp().getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: 'base' })
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toHaveLength(0);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });

  it('rolls back onboarding, outbox, and audit rows when the submit audit insert fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    const auditService = getApp().get(AuditService);

    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('submit audit insert failed'));

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'accept_terms',
        context: expect.objectContaining({
          email: expect.any(String),
        }),
        completed_at: null,
      }),
    ]);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });

  it('rolls back onboarding, outbox, and audit rows when the manual review audit insert fails', async () => {
    const onboardingId = await seedManualReviewOnboarding();
    const auditService = getApp().get(AuditService);

    jest
      .spyOn(auditService, 'log')
      .mockRejectedValueOnce(new Error('manual review audit insert failed'));

    await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/review/approve`)
      .expect(500);

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'manual-review',
        workflow_version: 1,
        status: 'awaiting_manual_review',
        current_step: 'awaiting_manual_review',
        context: {},
        completed_at: null,
      }),
    ]);
    expect(await readAuditRows(onboardingId)).toHaveLength(0);
  });
  it('keeps committed onboarding and audit rows when outbox insert fails during post-commit notify', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    const webhookRepository = getApp().get(WebhookRepository);

    jest
      .spyOn(webhookRepository, 'createPending')
      .mockRejectedValueOnce(new Error('outbox insert failed'));

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(response.body).toEqual({
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'approved',
        current_step: null,
        context: expect.objectContaining({
          email: expect.any(String),
          acceptedTerms: true,
        }),
        completed_at: expect.any(Date),
      }),
    ]);
    expect(await readOutboxRows(onboardingId)).toHaveLength(0);
    expect(await readAuditRows(onboardingId)).toHaveLength(1);
  });

  it('keeps committed onboarding, audit, and outbox rows when notification fails after commit', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    webhookResponseMode = 'failure';

    const response = await request(getApp().getHttpServer())
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((result) => expect([200, 201]).toContain(result.status));

    expect(response.body).toEqual({
      appliedStep: 'accept_terms',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(await readOnboardingRows(onboardingId)).toEqual([
      expect.objectContaining({
        id: onboardingId,
        workflow_id: 'base',
        workflow_version: 1,
        status: 'approved',
        current_step: null,
        context: expect.objectContaining({
          email: expect.any(String),
          acceptedTerms: true,
        }),
        completed_at: expect.any(Date),
      }),
    ]);

    expect(await readAuditRows(onboardingId)).toHaveLength(1);

    expect(await readOutboxRows(onboardingId)).toEqual([
      expect.objectContaining({
        onboarding_id: onboardingId,
        event_type: 'onboarding.state_changed',
        status: 'PENDING',
        attempts: 1,
        delivered_at: null,
      }),
    ]);
  });
});
