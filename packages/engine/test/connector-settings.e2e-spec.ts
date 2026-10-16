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
import { startE2eServer } from './e2e-server';

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
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:3900';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'onboardingdev';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'onboardingdevsecret0123456789';
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.AZURE_TENANT_ID = TENANT_ID;
process.env.AZURE_API_AUDIENCE = AUDIENCE;
process.env.ADMIN_REQUIRED_ROLES = 'admin';

import { AppModule } from '../src/app.module';
import { ADMIN_TOKEN_VERIFIER } from '../src/auth/admin-token-verifier.port';
import { AzureTokenVerifier, buildEntraIssuer } from '../src/auth/azure-token-verifier';

/** A connector already registered with a `settingsSchema`: one secret field, one plain field. */
const CONNECTOR_ID = 'sendgrid_email';
const SUBMITTED_API_KEY = 'SG.e2e-connector-settings-secret-do-not-leak';
const SUBMITTED_FROM = 'e2e-connector-settings@example.com';

/** Three declared keys and no cross-field pairing rule, so several can be written at once —
 * what the connector-scoped write lock has to be proved against. */
const OTP_CONNECTOR_ID = 'twilio_sms_otp';
const OTP_SMS_SETTINGS: Readonly<Record<string, string>> = {
  accountSid: `AC${'a'.repeat(32)}`,
  authToken: 'e2e-connector-settings-auth-token',
  messagingServiceSid: `MG${'b'.repeat(32)}`,
};

type SettingResponse = { key: string; secret: boolean; source: string; value?: string };
type ConnectorSettingsResponseBody = {
  id: string;
  type: string;
  scope: string;
  configured: boolean;
  settings: SettingResponse[];
};

/**
 * Proves the admin API's whole credential lifecycle against the real stack: a stored secret
 * never leaves the engine over the wire, and deleting it leaves the key unconfigured again.
 * Also proves the guard actually guards and that an unknown connector type is a 404, not a 500.
 * And proves `PATCH`'s whole reason for existing: merging one key never disturbs a stored
 * secret it does not name, and `null` deletes exactly the key it names.
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

  async function deleteStoredRow(connectorId: string = CONNECTOR_ID): Promise<void> {
    await dataSource.query('DELETE FROM connectors WHERE id = $1', [connectorId]);
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
    await startE2eServer(app);
    dataSource = app.get(DataSource);

    // Leaves no row behind from a previous run that failed before its own cleanup ran.
    await deleteStoredRow();
    await deleteStoredRow(OTP_CONNECTOR_ID);
  }, 60000);

  afterAll(async () => {
    await deleteStoredRow();
    await deleteStoredRow(OTP_CONNECTOR_ID);
    await app?.close();
  });

  it('answers 401 for a request carrying no token', async () => {
    await request(app!.getHttpServer()).get('/v1/admin/connectors').expect(401);
  });

  it('answers 404 for a connector type that is not registered', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/admin/connectors/not_a_real_connector_id')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('reports each connector by id alongside the class it belongs to', async () => {
    const token = await signToken();

    const response = await request(app!.getHttpServer())
      .get('/v1/admin/connectors')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const { connectors } = response.body as { connectors: ConnectorSettingsResponseBody[] };
    const byId = new Map(connectors.map((connector) => [connector.id, connector.type]));

    // Two providers of the same capability share one `type`, which is the point of the field.
    expect(byId.get('sendgrid_email')).toBe('email_delivery');
    expect(byId.get('smtp')).toBe('email_delivery');
    expect(byId.get('twilio_sms_otp')).toBe('otp_verification');
    // `smtp_email_otp` reads no settings of its own — SMTP's are on `smtp` — so it is not offered.
    expect(byId.has('smtp_email_otp')).toBe(false);
    // `http_request` takes its secrets from HTTP_CONNECTOR_SECRETS rather than from an operator,
    // so it declares no settingsSchema and this API must not offer it for configuration.
    expect(byId.has('http_request')).toBe(false);

    const sendgrid = connectors.find((connector) => connector.id === 'sendgrid_email');
    expect(sendgrid?.scope).toBe('built-in');
  });

  it('answers 404 for http_request, which is configured by environment rather than by an operator', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .get('/v1/admin/connectors/http_request')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('stamps the class its adapter declares onto the stored row', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: SUBMITTED_API_KEY, from: SUBMITTED_FROM } })
      .expect(200);

    try {
      const rows = await dataSource.query('SELECT id, type FROM connectors WHERE id = $1', [
        CONNECTOR_ID,
      ]);

      expect(rows).toEqual([{ id: 'sendgrid_email', type: 'email_delivery' }]);
    } finally {
      await deleteStoredRow();
    }
  });

  it('stores a credential, never returns it, and leaves the key unconfigured on delete', async () => {
    const token = await signToken();

    const putResponse = await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_ID}`)
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
      .get(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const getBody = getResponse.body as ConnectorSettingsResponseBody;
    expect(getBody.id).toBe(CONNECTOR_ID);
    expect(getBody.type).toBe('email_delivery');
    expect(getBody.scope).toBe('built-in');
    const getApiKey = findSetting(getBody, 'apiKey');
    expect(getApiKey.source).toBe('stored');
    expect(getApiKey.value).toBeUndefined();
    expect(getBody.configured).toBe(true);

    await request(app!.getHttpServer())
      .delete(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const afterDeleteResponse = await request(app!.getHttpServer())
      .get(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const afterDeleteApiKey = findSetting(
      afterDeleteResponse.body as ConnectorSettingsResponseBody,
      'apiKey',
    );
    expect(afterDeleteApiKey.source).toBe('unset');
    expect(afterDeleteApiKey.value).toBeUndefined();

    const rowsAfterDelete = await dataSource.query(
      'SELECT settings FROM connectors WHERE id = $1',
      [CONNECTOR_ID],
    );
    expect(rowsAfterDelete).toHaveLength(0);
  });

  it('rotates a stored credential against the real database: one row, holding the new value', async () => {
    const token = await signToken();
    const rotatedApiKey = 'SG.e2e-connector-settings-secret-rotated';
    const rotatedFrom = 'e2e-connector-settings-rotated@example.com';

    await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: SUBMITTED_API_KEY, from: SUBMITTED_FROM } })
      .expect(200);

    // The rotation itself: a second PUT with a different value, exercising
    // `ON CONFLICT (connector_type) DO UPDATE` rather than the insert path above.
    const rotateResponse = await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: rotatedApiKey, from: rotatedFrom } })
      .expect(200);

    expect(findSetting(rotateResponse.body as ConnectorSettingsResponseBody, 'from').value).toBe(
      rotatedFrom,
    );

    const rows = await dataSource.query<Array<{ settings: Record<string, string> }>>(
      'SELECT settings FROM connectors WHERE id = $1',
      [CONNECTOR_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toMatchObject({ apiKey: rotatedApiKey, from: rotatedFrom });

    await deleteStoredRow();
  });

  it('PATCHes one non-secret key, leaving the stored secret byte-for-byte unchanged and never returned', async () => {
    const token = await signToken();
    const patchedFrom = 'e2e-connector-settings-patched@example.com';

    const putResponse = await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { apiKey: SUBMITTED_API_KEY, from: SUBMITTED_FROM } })
      .expect(200);

    // The single behaviour this whole plan exists for: a PATCH that never mentions `apiKey`
    // must not touch it.
    const patchResponse = await request(app!.getHttpServer())
      .patch(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: { from: patchedFrom } })
      .expect(200);

    const patchBody = patchResponse.body as ConnectorSettingsResponseBody;
    expect(findSetting(patchBody, 'from').value).toBe(patchedFrom);
    const patchedApiKey = findSetting(patchBody, 'apiKey');
    expect(patchedApiKey.source).toBe('stored');
    expect(patchedApiKey.value).toBeUndefined();

    const getResponse = await request(app!.getHttpServer())
      .get(`/v1/admin/connectors/${CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const rows = await dataSource.query<Array<{ settings: Record<string, string> }>>(
      'SELECT settings FROM connectors WHERE id = $1',
      [CONNECTOR_ID],
    );
    expect(rows).toHaveLength(1);
    // Byte-for-byte: the exact string submitted in the earlier PUT, untouched by the PATCH.
    expect(rows[0].settings.apiKey).toBe(SUBMITTED_API_KEY);
    expect(rows[0].settings.from).toBe(patchedFrom);

    for (const response of [putResponse, patchResponse, getResponse]) {
      expect(JSON.stringify(response.body)).not.toContain(SUBMITTED_API_KEY);
    }

    await deleteStoredRow();
  });

  it('does not lose an update when PATCHes for the same connector overlap', async () => {
    const token = await signToken();

    await request(app!.getHttpServer())
      .put(`/v1/admin/connectors/${OTP_CONNECTOR_ID}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ settings: OTP_SMS_SETTINGS })
      .expect(200);

    const updates: Readonly<Record<string, string>> = {
      accountSid: `AC${'c'.repeat(32)}`,
      authToken: 'e2e-connector-settings-auth-token-updated',
      messagingServiceSid: `MG${'d'.repeat(32)}`,
    };

    // Every request reads the stored map, merges its own key in, and writes the whole map back.
    // Without the connector-scoped lock these interleave: each reads the same starting map, so
    // the last write puts back the pre-update values of the keys it does not name and erases
    // what the others just wrote. All three at once, against real Postgres.
    const responses = await Promise.all(
      Object.entries(updates).map(([key, value]) =>
        request(app!.getHttpServer())
          .patch(`/v1/admin/connectors/${OTP_CONNECTOR_ID}`)
          .set('Authorization', `Bearer ${token}`)
          .send({ settings: { [key]: value } }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([200, 200, 200]);

    const rows = await dataSource.query<Array<{ settings: Record<string, string> }>>(
      'SELECT settings FROM connectors WHERE id = $1',
      [OTP_CONNECTOR_ID],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].settings).toEqual(updates);

    await deleteStoredRow(OTP_CONNECTOR_ID);
  });
});
