import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';

const TENANT_ID = '33333333-3333-3333-3333-333333333333';
const AUDIENCE = '44444444-4444-4444-4444-444444444444';
const KEY_ID = 'persistence-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-0000000000ff';
const OPERATOR_UPN = 'audit.persistence@tsh.io';
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
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.AZURE_TENANT_ID = TENANT_ID;
process.env.AZURE_API_AUDIENCE = AUDIENCE;
process.env.ADMIN_REQUIRED_ROLES = 'admin';

import { AppModule } from '../src/app.module';
import { ADMIN_TOKEN_VERIFIER } from '../src/auth/admin-token-verifier.port';
import { AzureTokenVerifier, buildEntraIssuer } from '../src/auth/azure-token-verifier';

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
  let privateKey: KeyLike;
  let startedAt: Date;

  async function signToken(claims: { roles?: string[]; audience?: string } = {}): Promise<string> {
    return new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OBJECT_ID,
      preferred_username: OPERATOR_UPN,
      tid: TENANT_ID,
      ...('roles' in claims ? { roles: claims.roles } : { roles: ['admin'] }),
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject('operator-subject')
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(claims.audience ?? AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

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
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;

    const publicJwk = await exportJWK(keyPair.publicKey);
    const getKey: JWTVerifyGetKey = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });

    // The real engine, wired end to end, with only the network call to Entra's JWKS replaced.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ADMIN_TOKEN_VERIFIER)
      .useValue(new AzureTokenVerifier({ tenantId: TENANT_ID, audience: AUDIENCE, getKey }))
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();
    dataSource = app.get(DataSource);
  }, 60000);

  afterAll(async () => {
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
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.access_granted',
      actor_type: 'operator',
      actor_id: OPERATOR_OBJECT_ID,
      resource_type: 'admin_endpoint',
      resource_id: '/v1/onboardings',
    });
    expect(row.metadata).toEqual({
      method: 'GET',
      tenantId: TENANT_ID,
      userPrincipalName: OPERATOR_UPN,
      grantedRoles: ['admin'],
    });
  });

  it('persists a refusal with no operator fields, so an unverified caller is never named', async () => {
    await request(app!.getHttpServer()).get('/v1/onboardings').expect(401);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.token_rejected',
      actor_type: 'anonymous',
      actor_id: 'unknown',
      resource_id: '/v1/onboardings',
    });
    expect(row.metadata).toEqual({ method: 'GET', reason: 'Missing bearer access token' });
  });

  it('persists a role refusal against the operator who was turned away', async () => {
    const token = await signToken({ roles: ['auditor'] });

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const [row] = await waitForRows(1);

    expect(row).toMatchObject({
      action: 'auth.role_missing',
      actor_type: 'operator',
      actor_id: OPERATOR_OBJECT_ID,
    });
    expect(row.metadata).toEqual({
      method: 'GET',
      tenantId: TENANT_ID,
      userPrincipalName: OPERATOR_UPN,
      grantedRoles: ['auditor'],
      requiredRoles: ['admin'],
    });
  });

  it('reads the trail back through the admin API with its metadata intact', async () => {
    // The read path filters metadata through its own allowlist, so a row can persist correctly and
    // still reach the operator stripped. This is the only assertion that covers both directions.
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await waitForRows(1);

    const response = await request(app!.getHttpServer())
      .get('/v1/admin/audit')
      .query({ resourceType: 'admin_endpoint', action: 'auth.access_granted' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = response.body.items as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0]).toMatchObject({
      action: 'auth.access_granted',
      actorType: 'operator',
      actorId: OPERATOR_OBJECT_ID,
      resourceType: 'admin_endpoint',
      metadata: {
        method: 'GET',
        tenantId: TENANT_ID,
        userPrincipalName: OPERATOR_UPN,
        grantedRoles: ['admin'],
      },
    });
  });

  it('audits the audit endpoint itself, leaving no unrecorded way to read the trail', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/admin/audit')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const rows = await waitForRows(1);

    expect(rows.map((row) => [row.action, row.resource_id])).toContainEqual([
      'auth.access_granted',
      '/v1/admin/audit',
    ]);
  });

  it('records one row per request rather than collapsing repeated reads', async () => {
    const token = await signToken();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app!.getHttpServer())
        .get('/v1/onboardings')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }

    const rows = await waitForRows(3);

    expect(rows.filter((row) => row.action === 'auth.access_granted')).toHaveLength(3);
  });
});
