import 'reflect-metadata';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';
import { createOperator, deleteOperators, type Operator } from './admin-session.support';

const WORKFLOW_ID = 'eu-b2c-individual-kyc-eea';
const UNKNOWN_ID = 'admin-workflow-details-e2e-unknown';

interface DefinitionStep {
  name: string;
  source: { step: string; type: string; category: string } | null;
  fields: Array<{ name: string; upload: { contentTypes: string[] } | null }>;
  connectors: Array<{ fieldMapping: Record<string, string>; fallbacks: unknown[] }>;
}

const collectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (Array.isArray(value)) {
    value.forEach((item) => collectKeys(item, keys));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      keys.push(key);
      collectKeys(child, keys);
    }
  }
  return keys;
};

describe('Admin workflow details (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let operator: Operator;

  const setStoredStatus = async (version: number, status: string): Promise<void> => {
    await dataSource.query(
      `UPDATE workflow_versions wv
          SET status = $1
         FROM workflows w
        WHERE w.workflow_id = wv.workflow_id AND w.key = $2 AND wv.version = $3`,
      [status, WORKFLOW_ID, version],
    );
  };

  const getAdmin = (url: string) =>
    request(app.getHttpServer()).get(url).set('Cookie', operator.cookie);

  const getStep = (steps: DefinitionStep[], name: string): DefinitionStep => {
    const step = steps.find((candidate) => candidate.name === name);
    if (!step) throw new Error(`step ${name} missing from the definition`);
    return step;
  };

  beforeAll(async () => {
    process.env.ADMIN_AUTH_ENABLED = 'true';
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    await startE2eServer(app);
    dataSource = app.get(DataSource);

    operator = await createOperator(app!, { platformRole: 'superadmin', twoFactor: true });
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await deleteOperators(app);
      await setStoredStatus(1, 'published');
    }

    await app?.close();
  });

  it('lists every stored version newest first with its status', async () => {
    const response = await getAdmin(`/v1/admin/workflows/${WORKFLOW_ID}/versions`).expect(200);

    expect(response.body.items).toEqual([
      {
        version: 2,
        status: 'published',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
      {
        version: 1,
        status: 'published',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });

  it('lists a retired version and still serves its pinned definition', async () => {
    await setStoredStatus(1, 'retired');

    try {
      const versions = await getAdmin(`/v1/admin/workflows/${WORKFLOW_ID}/versions`).expect(200);
      expect(
        versions.body.items.map((item: { version: number; status: string }) => [
          item.version,
          item.status,
        ]),
      ).toEqual([
        [2, 'published'],
        [1, 'retired'],
      ]);

      const pinned = await getAdmin(`/v1/admin/workflows/${WORKFLOW_ID}/versions/1`).expect(200);
      expect(pinned.body).toMatchObject({ workflowId: WORKFLOW_ID, workflowVersion: 1 });
    } finally {
      await setStoredStatus(1, 'published');
    }
  });

  it('ignores a version query: the unpinned route serves the highest published version', async () => {
    const response = await getAdmin(`/v1/admin/workflows/${WORKFLOW_ID}`)
      .query({ version: 1 })
      .expect(200);

    expect(response.body).toMatchObject({ workflowId: WORKFLOW_ID, workflowVersion: 2 });
  });

  it('answers 404 for an unknown workflow on both routes', async () => {
    await getAdmin(`/v1/admin/workflows/${UNKNOWN_ID}/versions`)
      .expect(404)
      .expect({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });

    await getAdmin(`/v1/admin/workflows/${UNKNOWN_ID}`)
      .expect(404)
      .expect({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });

    await getAdmin(`/v1/admin/workflows/${UNKNOWN_ID}/versions/1`)
      .expect(404)
      .expect({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
  });

  describe('the v2 definition', () => {
    let definition: { webhook: unknown; steps: DefinitionStep[] };

    beforeAll(async () => {
      const response = await getAdmin(`/v1/admin/workflows/${WORKFLOW_ID}/versions/2`).expect(200);
      definition = response.body;
    });

    it('maps the compiled steps of one typed step to its authored step', () => {
      const compiled = ['send_phone_code', 'verify_phone_code', 'resend_phone_code'].map(
        (name) => getStep(definition.steps, name).source,
      );

      expect(compiled).toEqual(Array(3).fill(expect.objectContaining({ type: 'otp-verify' })));
      expect(new Set(compiled.map((source) => source?.step)).size).toBe(1);
      expect(getStep(definition.steps, 'approved').source).toMatchObject({ type: 'terminal' });
    });

    it('carries the notify webhook path', () => {
      expect(definition.webhook).toEqual({ notify: { path: 'notify' } });
    });

    it('carries fields with their upload limits on a capture step', () => {
      const passport = getStep(definition.steps, 'capture_passport');

      expect(passport.fields.length).toBeGreaterThan(0);
      expect(passport.fields.some((field) => field.upload?.contentTypes.length)).toBe(true);
    });

    it('carries connector identity and field mapping', () => {
      const submit = getStep(definition.steps, 'submit_kyc');

      expect(submit.connectors.length).toBeGreaterThan(0);
      expect(
        submit.connectors.some((connector) => Object.keys(connector.fieldMapping).length > 0),
      ).toBe(true);
    });

    it('exposes no connector config, retry or error handler anywhere under a step', () => {
      const keys = definition.steps.flatMap((step) => collectKeys(step.connectors));

      expect(keys.length).toBeGreaterThan(0);
      expect(keys).not.toContain('config');
      expect(keys).not.toContain('retry');
      expect(keys).not.toContain('errorHandler');
    });
  });

  it('answers 401 without a session on both routes', async () => {
    await request(app.getHttpServer())
      .get(`/v1/admin/workflows/${WORKFLOW_ID}/versions`)
      .expect(401);
    await request(app.getHttpServer()).get(`/v1/admin/workflows/${WORKFLOW_ID}`).expect(401);
    await request(app.getHttpServer())
      .get(`/v1/admin/workflows/${WORKFLOW_ID}/versions/1`)
      .expect(401);
  });
});
