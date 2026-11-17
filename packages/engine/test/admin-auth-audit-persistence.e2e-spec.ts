import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';
import { createOperator, deleteOperators, type Operator } from './admin-session.support';

const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3005';
process.env.DATABASE_URL =
  'postgres://orchestrator:orchestrator_pass@localhost:5432/orchestrator?sslmode=disable';
process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
process.env.STORAGE_DRIVER = 's3';
process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:3900';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'onboardingdev';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'onboardingdevsecret0123456789';
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
process.env.ADMIN_AUTH_ENABLED = 'true';

import { AppModule } from '../src/app.module';

type AuditRow = {
  action: string;
  actor_type: string;
  actor_id: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  occurred_at: Date;
};

/**
 * Every other audit assertion in this repository stops at the port: they prove the guard *asked*
 * for a row. This one runs the whole way into Postgres and back out through the admin API, which
 * is what "auditable" actually has to mean — the row has to survive the jsonb constraints, the
 * repository, and the read-path metadata filter.
 *
 * Requires the local stack (`pnpm stack:up`).
 */
describe('Admin access audit persistence (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;
  let startedAt: Date;

  /** A TOTP-enrolled organization member: may read, may not write encryption. */
  const memberOperator = (): Promise<Operator> =>
    createOperator(app!, { organizationRole: 'member', twoFactor: true });

  /**
   * The guard records without awaiting, so the row lands shortly after the response. Polling for
   * it is the honest way to assert on a deliberately fire-and-forget write.
   */
  async function waitForRows(expectedCount: number, timeoutMs = 5000): Promise<AuditRow[]> {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const rows: AuditRow[] = await dataSource.query(
        `SELECT action, actor_type, actor_id, resource_type, resource_id, metadata, occurred_at
           FROM audit_log
          WHERE resource_type = 'admin_endpoint' AND occurred_at >= $1
          ORDER BY occurred_at ASC, id ASC`,
        [startedAt],
      );

      if (rows.length >= expectedCount || Date.now() > deadline) {
        return rows;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  beforeAll(async () => {
    // The real engine, wired end to end; operators sign in through real better-auth sessions.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    await startE2eServer(app);
    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
    await deleteOperators(app!);
    if (dataSource?.isInitialized && startedAt) {
      await dataSource.query(
        `DELETE FROM audit_log WHERE resource_type = 'admin_endpoint' AND occurred_at >= $1`,
        [startedAt],
      );
    }

    await app?.close();
  });

  beforeEach(async () => {
    startedAt = new Date();
    // Postgres timestamps and the JS clock can land on the same millisecond; step back so the
    // window reliably includes rows written immediately after.
    startedAt.setMilliseconds(startedAt.getMilliseconds() - 1);

    await dataSource.query(`DELETE FROM audit_log WHERE resource_type = 'admin_endpoint'`);
  });

  it('persists a granted read to the database with the operator attached', async () => {
    const operator = await memberOperator();

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Cookie', operator.cookie)
      .expect(200);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.access_granted',
      actor_type: 'operator',
      actor_id: operator.userId,
      resource_type: 'admin_endpoint',
      resource_id: '/v1/onboardings',
    });
    expect(row.metadata).toMatchObject({
      method: 'GET',
      email: operator.email,
      organizationId: operator.organizationId,
    });
  });

  it('persists a refusal with no operator fields, so an unverified caller is never named', async () => {
    await request(app!.getHttpServer()).get('/v1/onboardings').expect(401);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.session_missing',
      actor_type: 'anonymous',
      actor_id: 'unknown',
      resource_id: '/v1/onboardings',
    });
    expect(row.metadata).toEqual({ method: 'GET', reason: 'No valid admin session' });
  });

  it('refuses a session-less manual review decision before the onboarding is looked up', async () => {
    // The guard runs ahead of the action pipe and the lookup, so an anonymous caller gets 401 and
    // an audit row, never a 400 or 404 that would reveal whether the id exists.
    await request(app!.getHttpServer())
      .post('/v1/onboardings/01912345-6789-7abc-8def-0123456789aa/review/approve')
      .expect(401);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.session_missing',
      actor_type: 'anonymous',
      actor_id: 'unknown',
      // The registered pattern, not the concrete path, so one route stays one auditable resource.
      resource_id: '/v1/onboardings/:id/review/:action',
    });
    expect(row.metadata).toEqual({ method: 'POST', reason: 'No valid admin session' });
  });

  it('persists a TOTP refusal against the operator who was turned away', async () => {
    const operator = await createOperator(app!, { platformRole: 'superadmin' });

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Cookie', operator.cookie)
      .expect(403);

    const rows = await waitForRows(1);
    const row = rows.find((candidate) => candidate.action === 'auth.two_factor_required');

    expect(row).toMatchObject({ actor_type: 'operator', actor_id: operator.userId });
    expect(row?.metadata).toMatchObject({
      method: 'GET',
      email: operator.email,
      platformRole: 'superadmin',
    });
  });

  it('persists a permission refusal against the operator, naming the permission', async () => {
    const operator = await memberOperator();

    await request(app!.getHttpServer())
      .post('/v1/admin/encryption/keys')
      .set('Cookie', operator.cookie)
      .expect(403);

    const rows = await waitForRows(1);
    const row = rows.find((candidate) => candidate.action === 'auth.permission_missing');

    expect(row).toMatchObject({ actor_type: 'operator', actor_id: operator.userId });
    expect(row?.metadata).toMatchObject({
      method: 'POST',
      email: operator.email,
      organizationId: operator.organizationId,
      requiredPermission: 'encryption:write',
    });
  });

  it('reads the trail back through the admin API with its metadata intact', async () => {
    // The read path filters metadata through its own allowlist, so a row can persist correctly and
    // still reach the operator stripped. This is the only assertion that covers both directions.
    const operator = await memberOperator();

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Cookie', operator.cookie)
      .expect(200);
    await waitForRows(1);

    const response = await request(app!.getHttpServer())
      .get('/v1/admin/audit')
      .query({ resourceType: 'admin_endpoint', action: 'auth.access_granted' })
      .set('Cookie', operator.cookie)
      .expect(200);

    const items = response.body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({
      action: 'auth.access_granted',
      actorType: 'operator',
      actorId: operator.userId,
      resourceType: 'admin_endpoint',
      metadata: { method: 'GET', email: operator.email, organizationId: operator.organizationId },
    });
  });

  it('audits the audit endpoint itself, leaving no unrecorded way to read the trail', async () => {
    const operator = await createOperator(app!, { platformRole: 'superadmin', twoFactor: true });

    await request(app!.getHttpServer())
      .get('/v1/admin/audit')
      .set('Cookie', operator.cookie)
      .expect(200);

    const rows = await waitForRows(1);

    expect(rows.map((row) => [row.action, row.resource_id])).toContainEqual([
      'auth.access_granted',
      '/v1/admin/audit',
    ]);
  });

  it('records one row per request rather than collapsing repeated reads', async () => {
    const operator = await memberOperator();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app!.getHttpServer())
        .get('/v1/onboardings')
        .set('Cookie', operator.cookie)
        .expect(200);
    }

    const rows = await waitForRows(3);

    expect(rows.filter((row) => row.action === 'auth.access_granted')).toHaveLength(3);
  });
});
