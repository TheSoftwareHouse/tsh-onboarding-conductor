import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Client, type Pool } from 'pg';
import request from 'supertest';
import { startE2eServer } from './e2e-server';
import { createOperator, OPERATOR_EMAIL_DOMAIN, OPERATOR_PASSWORD } from './admin-session.support';

const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3002';
process.env.DATABASE_URL =
  'postgres://orchestrator:orchestrator_pass@localhost:5432/e2e_admin_auth?sslmode=disable';
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
import { BETTER_AUTH_POOL } from '../src/auth/better-auth/better-auth.tokens';

/**
 * This spec demotes superadmins to assert the last-superadmin rule and boots the seed twice, so it
 * runs in a database of its own, created on the shared stack's server and dropped afterwards.
 * Nothing it does can reach the developer's seeded superadmin. `DATABASE_URL` above names it
 * statically because the config module reads the environment when `AppModule` is imported.
 */
const ISOLATED_DATABASE = 'e2e_admin_auth';

/** Runs `statement` against the server's maintenance database, which can create and drop others. */
async function runAdminStatement(statement: string): Promise<void> {
  const url = new URL(process.env.DATABASE_URL as string);
  url.pathname = '/postgres';
  const client = new Client({ connectionString: url.toString() });
  await client.connect();

  try {
    await client.query(statement);
  } finally {
    await client.end();
  }
}

const READ_ROUTES = ['/v1/onboardings', '/v1/admin/audit'];
/** Guard runs before validation and the handler, so this refuses a body-less call with no side effect. */
const WRITE_ROUTE = '/v1/admin/encryption/keys';

async function bootApp(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>();
  await startE2eServer(app);

  return app;
}

/**
 * The real engine with `ADMIN_AUTH_ENABLED=true`: every guard outcome, driven with real better-auth
 * session cookies over HTTP. Requires the local stack (`pnpm test:e2e` brings it up).
 */
describe('Admin endpoint authentication (e2e)', () => {
  let app: NestExpressApplication;
  let pool: Pool;

  beforeAll(async () => {
    await runAdminStatement(`DROP DATABASE IF EXISTS ${ISOLATED_DATABASE} WITH (FORCE)`);
    await runAdminStatement(`CREATE DATABASE ${ISOLATED_DATABASE}`);
    app = await bootApp();
    pool = app.get<Pool>(BETTER_AUTH_POOL);
  }, 60000);

  afterAll(async () => {
    await app?.close();
    await runAdminStatement(`DROP DATABASE IF EXISTS ${ISOLATED_DATABASE} WITH (FORCE)`);
  });

  /**
   * Leaves `keepId` as the only active superadmin so the last-superadmin rule is assertable. Only
   * the disposable operators of this spec's own database are demoted: the database is isolated
   * (see `ISOLATED_DATABASE`), so no real account can be touched, whatever state a run dies in.
   */
  async function makeOnlySuperadmin(keepId: string): Promise<void> {
    await pool.query(
      `UPDATE auth."user" SET "role" = 'user'
        WHERE "id" <> $1 AND 'superadmin' = ANY(string_to_array("role", ','))`,
      [keepId],
    );
  }

  it('answers GET /v1/auth/ok through the mounted better-auth handler', async () => {
    const response = await request(app.getHttpServer()).get('/v1/auth/ok').expect(200);

    expect(response.body).toEqual({ ok: true });
  });

  describe.each(READ_ROUTES)('%s', (route) => {
    it('answers 401 ADMIN_SESSION_REQUIRED without a session', async () => {
      const response = await request(app.getHttpServer()).get(route).expect(401);

      expect(response.body.code).toBe('ADMIN_SESSION_REQUIRED');
    });

    it('answers 401 for a cookie that names no session', async () => {
      await request(app.getHttpServer())
        .get(route)
        .set('Cookie', 'better-auth.session_token=not-a-real-session')
        .expect(401);
    });

    it('answers 403 TWO_FACTOR_REQUIRED for a credential superadmin without TOTP', async () => {
      const operator = await createOperator(app, { platformRole: 'superadmin' });

      const response = await request(app.getHttpServer())
        .get(route)
        .set('Cookie', operator.cookie)
        .expect(403);

      expect(response.body.code).toBe('TWO_FACTOR_REQUIRED');
    });

    it('answers 403 ADMIN_PERMISSION_MISSING for a user with no organization', async () => {
      const operator = await createOperator(app, { twoFactor: true });

      const response = await request(app.getHttpServer())
        .get(route)
        .set('Cookie', operator.cookie)
        .expect(403);

      expect(response.body.code).toBe('ADMIN_PERMISSION_MISSING');
    });

    it('answers 200 for a superadmin with TOTP', async () => {
      const operator = await createOperator(app, { platformRole: 'superadmin', twoFactor: true });

      await request(app.getHttpServer()).get(route).set('Cookie', operator.cookie).expect(200);
    });
  });

  it('gives a single-organization member that organization as active in a fresh session and lets them read', async () => {
    const operator = await createOperator(app, { organizationRole: 'member', twoFactor: true });

    const { rows } = await pool.query(
      `SELECT s."activeOrganizationId" FROM auth."session" s
         JOIN auth."user" u ON u."id" = s."userId" WHERE u."id" = $1`,
      [operator.userId],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].activeOrganizationId).toBe(operator.organizationId);
    await request(app.getHttpServer())
      .get('/v1/onboardings')
      .set('Cookie', operator.cookie)
      .expect(200);
  });

  it('answers 403 ADMIN_PERMISSION_MISSING when a member lacks the route permission', async () => {
    const operator = await createOperator(app, { organizationRole: 'member', twoFactor: true });

    const response = await request(app.getHttpServer())
      .post(WRITE_ROUTE)
      .set('Cookie', operator.cookie)
      .expect(403);

    expect(response.body.code).toBe('ADMIN_PERMISSION_MISSING');
  });

  describe('better-auth admin and organization endpoints', () => {
    it.each(['/v1/auth/organization/invite-member', '/v1/auth/admin/set-role'])(
      'refuses %s to a credential superadmin without TOTP',
      async (path) => {
        const operator = await createOperator(app, { platformRole: 'superadmin' });

        const response = await request(app.getHttpServer())
          .post(path)
          .set('Cookie', operator.cookie)
          .send({ userId: operator.userId, role: 'user' })
          .expect(403);

        expect(response.body.code).toBe('TWO_FACTOR_REQUIRED');
      },
    );

    it('refuses impersonation to a superadmin with TOTP', async () => {
      const operator = await createOperator(app, { platformRole: 'superadmin', twoFactor: true });
      const target = await createOperator(app);

      const response = await request(app.getHttpServer())
        .post('/v1/auth/admin/impersonate-user')
        .set('Cookie', operator.cookie)
        .send({ userId: target.userId })
        .expect(403);

      expect(response.headers['set-cookie']).toBeUndefined();
    });

    it('refuses to demote the last superadmin', async () => {
      const operator = await createOperator(app, { platformRole: 'superadmin', twoFactor: true });

      await makeOnlySuperadmin(operator.userId);

      const response = await request(app.getHttpServer())
        .post('/v1/auth/admin/set-role')
        .set('Cookie', operator.cookie)
        .send({ userId: operator.userId, role: 'user' })
        .expect(403);

      expect(response.body.code).toBe('LAST_SUPERADMIN');
    });
  });

  describe('invite-only sign-up', () => {
    it('refuses email sign-up without an invitation and creates no user', async () => {
      const email = `${randomUUID()}@${OPERATOR_EMAIL_DOMAIN}`;

      await request(app.getHttpServer())
        .post('/v1/auth/sign-up/email')
        .send({ email, password: OPERATOR_PASSWORD, name: 'Uninvited' })
        .expect(403);

      const { rowCount } = await pool.query('SELECT 1 FROM auth."user" WHERE "email" = $1', [
        email,
      ]);
      expect(rowCount).toBe(0);
    });

    it('accepts email sign-up when a pending invitation exists', async () => {
      const inviter = await createOperator(app, { organizationRole: 'owner' });
      const email = `${randomUUID()}@${OPERATOR_EMAIL_DOMAIN}`;
      await pool.query(
        `INSERT INTO auth."invitation" ("id", "organizationId", "email", "role", "status", "expiresAt", "inviterId")
         VALUES ($1, $2, $3, 'member', 'pending', now() + interval '1 day', $4)`,
        [randomUUID(), inviter.organizationId, email, inviter.userId],
      );

      await request(app.getHttpServer())
        .post('/v1/auth/sign-up/email')
        .send({ email, password: OPERATOR_PASSWORD, name: 'Invitee' })
        .expect(200);

      const { rowCount } = await pool.query('SELECT 1 FROM auth."user" WHERE "email" = $1', [
        email,
      ]);
      expect(rowCount).toBe(1);
    });
  });

  it('leaves the public onboarding start endpoint and health unauthenticated', async () => {
    await request(app.getHttpServer()).get('/v1/health/live').expect(200);
    // Not 401/403: the public flow answers whatever it does with no cookie (here, a validation reply).
    const response = await request(app.getHttpServer()).post('/v1/onboardings').send({});
    expect([401, 403]).not.toContain(response.status);
  });

  describe('superadmin seed', () => {
    const seedEmail = `seed-${randomUUID()}@${OPERATOR_EMAIL_DOMAIN}`;

    it('creates exactly one superadmin across two boots', async () => {
      const keep = await createOperator(app);

      await makeOnlySuperadmin(keep.userId);
      process.env.AUTH_SUPERADMIN_EMAIL = seedEmail;
      process.env.AUTH_SUPERADMIN_PASSWORD = OPERATOR_PASSWORD;

      try {
        for (let boot = 0; boot < 2; boot += 1) {
          const seeded = await bootApp();
          await seeded.close();
        }
      } finally {
        delete process.env.AUTH_SUPERADMIN_EMAIL;
        delete process.env.AUTH_SUPERADMIN_PASSWORD;
      }

      const { rows } = await pool.query(
        `SELECT "email" FROM auth."user" WHERE 'superadmin' = ANY(string_to_array("role", ','))`,
      );
      expect(rows).toEqual([{ email: seedEmail }]);
    }, 90000);
  });
});
