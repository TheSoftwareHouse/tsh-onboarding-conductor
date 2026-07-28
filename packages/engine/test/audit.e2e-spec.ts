import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { createServer, IncomingMessage, Server } from 'node:http';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AuditService } from '../src/audit/audit.service';
import { WebhookRepository } from '../src/webhook/webhook.repository';

jest.setTimeout(30000);

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

  it('rolls back onboarding, outbox, and audit rows when the audit insert fails', async () => {
    const onboardingId = await seedAcceptedSubmitOnboarding();
    const auditService = getApp().get(AuditService);

    jest.spyOn(auditService, 'log').mockRejectedValueOnce(new Error('audit insert failed'));

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
    expect(await readOutboxRows(onboardingId)).toHaveLength(0);
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
