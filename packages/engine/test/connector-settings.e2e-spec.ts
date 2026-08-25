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

const TENANT_ID = '55555555-5555-5555-5555-555555555555';
const AUDIENCE = '66666666-6666-6666-6666-666666666666';
const KEY_ID = 'connector-settings-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-0000000000cc';
const OPERATOR_UPN = 'connector.settings@tsh.io';
const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3006';
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

/** A connector already registered with a `settingsSchema`: one secret field, one plain field. */
const CONNECTOR_TYPE = 'sendgrid_email';
const SUBMITTED_API_KEY = 'SG.e2e-connector-settings-secret-do-not-leak';
const SUBMITTED_FROM = 'e2e-connector-settings@example.com';

type SettingResponse = { key: string; secret: boolean; source: string; value?: string };
type ConnectorSettingsResponseBody = {
  type: string;
  configured: boolean;
  settings: SettingResponse[];
};

/**
 * Proves the admin API's whole credential lifecycle against the real stack: a stored secret
 * never leaves the engine over the wire, and deleting it leaves the key unconfigured again.
 * Also proves the guard actually guards and that an unknown connector type is a 404, not a 500.
 *
 * Requires the local stack (`pnpm stack:up`).
 */
describe('Connector settings admin API (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;
  let privateKey: KeyLike;

  async function signToken(): Promise<string> {
    return new SignJWT({
      scp: 'Onboardings.Read',
      oid: OPERATOR_OBJECT_ID,
      preferred_username: OPERATOR_UPN,
      tid: TENANT_ID,
      roles: ['admin'],
    })
      .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
      .setSubject('operator-subject')
      .setIssuer(buildEntraIssuer(TENANT_ID))
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey);
  }

  function findSetting(body: ConnectorSettingsResponseBody, key: string): SettingResponse {
    const setting = body.settings.find((candidate) => candidate.key === key);
    expect(setting).toBeDefined();

    return setting!;
  }

  async function deleteStoredRow(): Promise<void> {
    await dataSource.query('DELETE FROM connector_settings WHERE connector_type = $1', [
      CONNECTOR_TYPE,
    ]);
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

    // Leaves no row behind from a previous run that failed before its own cleanup ran.
    await deleteStoredRow();
  }, 60000);

  afterAll(async () => {
    await deleteStoredRow();
    await app?.close();
  });

  it('answers 401 for a request carrying no token', async () => {
    await request(app!.getHttpServer()).get('/v1/admin/connectors').expect(401);
  });

  it('answers 404 for a connector type that is not registered', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/admin/connectors/not_a_real_connector_type')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('stores a credential, never returns it, and leaves the key unconfigured on delete', async () => {
    const token = await signToken();

    const putResponse = await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: SUBMITTED_API_KEY, from: SUBMITTED_FROM } })
      .expect(200);

    const putBody = putResponse.body as ConnectorSettingsResponseBody;
    const putApiKey = findSetting(putBody, 'apiKey');
    expect(putApiKey.secret).toBe(true);
    expect(putApiKey.source).toBe('stored');
    expect(putApiKey.value).toBeUndefined();
    expect(findSetting(putBody, 'from').value).toBe(SUBMITTED_FROM);

    const getResponse = await request(app!.getHttpServer())
      .get(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const getBody = getResponse.body as ConnectorSettingsResponseBody;
    const getApiKey = findSetting(getBody, 'apiKey');
    expect(getApiKey.source).toBe('stored');
    expect(getApiKey.value).toBeUndefined();
    expect(getBody.configured).toBe(true);

    await request(app!.getHttpServer())
      .delete(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const afterDeleteResponse = await request(app!.getHttpServer())
      .get(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const afterDeleteApiKey = findSetting(
      afterDeleteResponse.body as ConnectorSettingsResponseBody,
      'apiKey',
    );
    expect(afterDeleteApiKey.source).toBe('unset');
    expect(afterDeleteApiKey.value).toBeUndefined();

    const rowsAfterDelete = await dataSource.query(
      'SELECT settings FROM connector_settings WHERE connector_type = $1',
      [CONNECTOR_TYPE],
    );
    expect(rowsAfterDelete).toHaveLength(0);
  });

  it('rotates a stored credential against the real database: one row, holding the new value', async () => {
    const token = await signToken();
    const rotatedApiKey = 'SG.e2e-connector-settings-secret-rotated';
    const rotatedFrom = 'e2e-connector-settings-rotated@example.com';

    await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: SUBMITTED_API_KEY, from: SUBMITTED_FROM } })
      .expect(200);

    // The rotation itself: a second PUT with a different value, exercising
    // `ON CONFLICT (connector_type) DO UPDATE` rather than the insert path above.
    const rotateResponse = await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_TYPE}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: rotatedApiKey, from: rotatedFrom } })
      .expect(200);

    expect(findSetting(rotateResponse.body as ConnectorSettingsResponseBody, 'from').value).toBe(
      rotatedFrom,
    );

    const rows = await dataSource.query<Array<{ settings: Record<string, string> }>>(
      'SELECT settings FROM connector_settings WHERE connector_type = $1',
      [CONNECTOR_TYPE],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toMatchObject({ apiKey: rotatedApiKey, from: rotatedFrom });

    await deleteStoredRow();
  });
});
