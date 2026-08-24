import { randomBytes } from 'node:crypto';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import {
  SENDGRID_EMAIL_CONNECTOR_TYPE,
  SMTP_CONNECTOR_TYPE,
  TWILIO_VERIFY_CONNECTOR_TYPE,
} from '../src/connector-settings/connector-setting-declarations';

jest.setTimeout(120000);

const CONNECTOR_SETTINGS_ENDPOINT = '/v1/admin/connectors';
const ENCRYPTION_KEY = randomBytes(32).toString('base64');
const CONFIGURED_CONNECTOR_TYPES = [
  TWILIO_VERIFY_CONNECTOR_TYPE,
  SENDGRID_EMAIL_CONNECTOR_TYPE,
  SMTP_CONNECTOR_TYPE,
];

type ConnectorSettingsRow = { connector_type: string; settings: Record<string, string> };

let app: NestExpressApplication | null = null;

const getApp = (): NestExpressApplication => {
  if (!app) {
    throw new Error('Nest application is not initialised');
  }

  return app;
};

const dataSource = (): DataSource => getApp().get(DataSource);

const readRow = async (connectorType: string): Promise<ConnectorSettingsRow | undefined> => {
  const rows = (await dataSource().query(
    `SELECT connector_type, settings FROM connector_settings WHERE connector_type = $1`,
    [connectorType],
  )) as ConnectorSettingsRow[];

  return rows[0];
};

const findField = (body: { fields: Array<Record<string, unknown>> }, key: string) =>
  body.fields.find((field) => field.key === key);

beforeAll(async () => {
  // This suite sends no Entra ID token; admin auth has its own e2e spec.
  process.env.ADMIN_AUTH_ENABLED = 'false';
  // A key of its own, so a run neither depends on nor rewrites what .env configures.
  process.env.CONNECTOR_SETTINGS_ENCRYPTION_KEY = ENCRYPTION_KEY;

  const { createApp } = await import('../src/main');

  const appBundle = await createApp();
  app = appBundle.app;
  await app.init();
});

afterEach(async () => {
  await dataSource().query(`DELETE FROM connector_settings WHERE connector_type = ANY($1)`, [
    CONFIGURED_CONNECTOR_TYPES,
  ]);
  await dataSource().query(`DELETE FROM audit_log WHERE action = $1`, [
    'connector_settings.updated',
  ]);
});

afterAll(async () => {
  await app?.close();
});

describe('connector settings', () => {
  it('creates the connector_settings table with the connector type as its primary key', async () => {
    const tables = (await dataSource().query(
      `SELECT to_regclass('public.connector_settings') AS table_name`,
    )) as Array<{ table_name: string | null }>;
    expect(tables[0].table_name).toBe('connector_settings');

    const keyColumns = (await dataSource().query(
      `SELECT a.attname AS column_name
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'public.connector_settings'::regclass AND i.indisprimary`,
    )) as Array<{ column_name: string }>;
    expect(keyColumns.map((column) => column.column_name)).toEqual(['connector_type']);
  });

  it('lists every configurable connector with the source each field takes effect from', async () => {
    const response = await request(getApp().getHttpServer())
      .get(CONNECTOR_SETTINGS_ENDPOINT)
      .expect(200);

    const items = response.body.items as Array<{
      connectorType: string;
      label: string;
      fields: Array<Record<string, unknown>>;
    }>;

    expect(items.map((item) => item.connectorType)).toEqual(CONFIGURED_CONNECTOR_TYPES);

    const sendgrid = items.find(
      (item) => item.connectorType === SENDGRID_EMAIL_CONNECTOR_TYPE,
    ) as (typeof items)[number];
    expect(findField(sendgrid, 'apiKey')).toEqual({
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      // Whatever the deployment's .env supplies; a secret never carries its value either way.
      source: expect.stringMatching(/^(environment|unset)$/),
      value: null,
    });
  });

  it('stores a secret encrypted and reports it as configured without reading it back', async () => {
    const response = await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SENDGRID_EMAIL_CONNECTOR_TYPE}`)
      .send({ values: { apiKey: 'SG.e2e-secret', from: 'e2e@example.com' } })
      .expect(200);

    expect(findField(response.body, 'apiKey')).toMatchObject({
      source: 'database',
      value: null,
    });
    expect(findField(response.body, 'from')).toMatchObject({
      source: 'database',
      value: 'e2e@example.com',
    });

    const row = await readRow(SENDGRID_EMAIL_CONNECTOR_TYPE);
    expect(row?.settings.apiKey).toMatch(/^enc\.v1\./);
    expect(row?.settings.apiKey).not.toContain('SG.e2e-secret');
    // A value that is not a credential is stored as typed, so it can be shown in the panel.
    expect(row?.settings.from).toBe('e2e@example.com');

    await request(getApp().getHttpServer())
      .get(CONNECTOR_SETTINGS_ENDPOINT)
      .expect(200)
      .expect((result) => {
        const sendgrid = (result.body.items as Array<{ connectorType: string }>).find(
          (item) => item.connectorType === SENDGRID_EMAIL_CONNECTOR_TYPE,
        );
        expect(findField(sendgrid as never, 'apiKey')).toMatchObject({
          source: 'database',
          value: null,
        });
      });
  });

  it('leaves the settings it was not sent alone, and removes the row once the last one is cleared', async () => {
    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
      .send({ values: { host: 'smtp.example.com', password: 'e2e-password' } })
      .expect(200);

    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
      .send({ values: { password: '' } })
      .expect(200);

    expect(Object.keys((await readRow(SMTP_CONNECTOR_TYPE))?.settings ?? {})).toEqual(['host']);

    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
      .send({ values: { host: '' } })
      .expect(200);

    expect(await readRow(SMTP_CONNECTOR_TYPE)).toBeUndefined();
  });

  it('merges concurrent saves of different fields instead of losing one of them', async () => {
    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
      .send({ values: { host: 'smtp.example.com' } })
      .expect(200);

    // Both start from the same stored row. A read-modify-write would let whichever commits second
    // overwrite the other's field.
    await Promise.all([
      request(getApp().getHttpServer())
        .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
        .send({ values: { from: 'ops@example.com' } })
        .expect(200),
      request(getApp().getHttpServer())
        .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SMTP_CONNECTOR_TYPE}`)
        .send({ values: { username: 'relay-user' } })
        .expect(200),
    ]);

    expect(Object.keys((await readRow(SMTP_CONNECTOR_TYPE))?.settings ?? {}).sort()).toEqual([
      'from',
      'host',
      'username',
    ]);
  });

  it('records which settings changed, and never what they became', async () => {
    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SENDGRID_EMAIL_CONNECTOR_TYPE}`)
      .send({ values: { apiKey: 'SG.audited-secret', from: 'ops@example.com' } })
      .expect(200);

    const rows = (await dataSource().query(
      `SELECT actor_type, action, resource_type, resource_id, metadata
         FROM audit_log
        WHERE action = $1 AND resource_id = $2
        ORDER BY occurred_at DESC
        LIMIT 1`,
      ['connector_settings.updated', SENDGRID_EMAIL_CONNECTOR_TYPE],
    )) as Array<Record<string, unknown>>;

    expect(rows[0]).toMatchObject({
      action: 'connector_settings.updated',
      resource_type: 'connector_settings',
      resource_id: SENDGRID_EMAIL_CONNECTOR_TYPE,
      metadata: { storedKeys: ['apiKey', 'from'], clearedKeys: [] },
    });
    expect(JSON.stringify(rows[0])).not.toContain('SG.audited-secret');
  });

  it('stores nothing for a body whose only key names an object prototype member', async () => {
    // `class-transformer` drops `__proto__` before the handler runs, so the request reaches the
    // service carrying no settings at all and is a no-op rather than a refusal. The service
    // refuses the key on its own account too — see the unit spec — which is what keeps that from
    // depending on the pipeline's behaviour.
    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SENDGRID_EMAIL_CONNECTOR_TYPE}`)
      .send({ values: JSON.parse('{"__proto__":"x"}') })
      .expect(200);

    expect(await readRow(SENDGRID_EMAIL_CONNECTOR_TYPE)).toBeUndefined();
  });

  it('refuses a connector that declares no settings and a key it does not declare', async () => {
    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/http_request`)
      .send({ values: { apiKey: 'x' } })
      .expect(404)
      .expect((result) => {
        expect(result.body.code).toBe('CONNECTOR_SETTINGS_NOT_CONFIGURABLE');
      });

    await request(getApp().getHttpServer())
      .put(`${CONNECTOR_SETTINGS_ENDPOINT}/${SENDGRID_EMAIL_CONNECTOR_TYPE}`)
      .send({ values: { sender: 'e2e@example.com' } })
      .expect(400)
      .expect((result) => {
        expect(result.body).toMatchObject({
          code: 'INVALID_CONNECTOR_SETTINGS',
          errors: { sender: ['UNKNOWN'] },
        });
      });

    expect(await readRow(SENDGRID_EMAIL_CONNECTOR_TYPE)).toBeUndefined();
  });
});
