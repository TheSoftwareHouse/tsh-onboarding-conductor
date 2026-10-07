import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BUILT_IN_WORKFLOWS_DIR } from '../src/workflows/workflow-roots';
import { startE2eServer } from './e2e-server';

const authored = JSON.parse(
  readFileSync(
    path.join(BUILT_IN_WORKFLOWS_DIR, 'eu-b2c-individual-kyc-eea-v2.workflow.json'),
    'utf8',
  ),
) as { steps: Array<Record<string, unknown>>; sourceKey?: string };

describe('Workflow compile (e2e)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false, limit: '2mb' });
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('compiles the built-in workflow and reports its compiled steps, its steps and the projection', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(authored)
      .expect(200);

    expect(response.body.definition.steps.map((step: { name: string }) => step.name)).toEqual([
      'collect_contact',
      'send_phone_code',
      'verify_phone_code',
      'resend_phone_code',
      'collect_personal',
      'collect_purpose',
      'select_document_type',
      'capture_passport',
      'capture_id_card_front',
      'capture_id_card_back',
      'capture_selfie',
      'submit_kyc',
      'manual_review',
      'provision_account',
      'await_account',
      'approved',
      'rejected',
      'invalid',
    ]);
    expect(response.body.steps).toHaveLength(15);
    expect(response.body.steps[8]).toMatchObject({
      name: 'submit_kyc',
      type: 'kyc-identity-verification',
      ports: expect.arrayContaining([
        { name: 'retry.IDENTITY', arms: [{ target: 'select_document_type' }] },
      ]),
    });
    expect(response.body.workflow).toMatchObject({
      workflowId: 'eu-b2c-individual-kyc-eea',
      workflowVersion: 2,
      initialStep: 'collect_contact',
    });
  });

  it('refuses a broken graph with the reason and the path to the step at fault', async () => {
    // `collect_personal`, whose one port is `success`, loses its edge.
    const broken = {
      ...authored,
      steps: authored.steps.map((step, index) => (index === 2 ? { ...step, edges: {} } : step)),
    };

    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(broken)
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'WORKFLOW_INVALID',
      message: 'WORKFLOW_INVALID',
      reason: 'INVALID_TRANSITIONS',
      path: 'steps[2].edges.success',
    });
  });

  it('refuses a document still written as untyped steps, naming the step that lacks a type', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send({
        id: 'old',
        version: 1,
        steps: [{ name: 'done', status: 'approved', data: {}, transitions: [] }],
      })
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'WORKFLOW_INVALID',
      reason: 'INVALID_SHAPE',
      path: 'steps[0]',
    });
  });

  it("refuses a connector declaration the adapter rejects, in the adapter's words", async () => {
    // A GET carrying a body passes the DDL — the request is opaque config to it — and is the
    // `http_request` adapter's to refuse.
    const broken = {
      ...authored,
      steps: authored.steps.map((step) => {
        if (step.name !== 'provision_account') {
          return step;
        }

        const config = step.config as { request: Record<string, unknown> };

        return { ...step, config: { ...config, request: { ...config.request, method: 'GET' } } };
      }),
    };

    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(broken)
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'WORKFLOW_CONNECTOR_DECLARATION_INVALID',
      stepName: 'provision_account',
    });
    expect(response.body.detail).toContain('request.body');
  });

  it('stores nothing: a compiled document is not a revision', async () => {
    const compiled = { ...authored, version: 99 };

    await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(compiled)
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/admin/workflows/eu-b2c-individual-kyc-eea/versions/99')
      .expect(404);
  });

  it('serves the palette and the workflow schema a builder validates against', async () => {
    const palette = await request(app.getHttpServer()).get('/v1/admin/step-types').expect(200);

    expect(palette.body.stepTypes).toHaveLength(20);
    expect(palette.body.stepTypes.map((stepType: { type: string }) => stepType.type)).toEqual(
      expect.arrayContaining([
        'kyc-identity-verification',
        'otp-verify',
        'connector-call',
        'custom',
      ]),
    );
    expect(
      palette.body.stepTypes.find((stepType: { type: string }) => stepType.type === 'terminal'),
    ).toMatchObject({
      category: 'terminal',
      composable: false,
      connectorTypes: [],
      configSchema: { required: ['outcome'] },
    });
    expect(
      palette.body.stepTypes.find(
        (stepType: { type: string }) => stepType.type === 'kyc-identity-verification',
      ).connectorTypes,
    ).toEqual(['kyc']);

    const schema = await request(app.getHttpServer())
      .get('/v1/admin/step-types/schema')
      .expect(200);

    expect(schema.body).toMatchObject({ title: 'Onboarding workflow' });
    expect(schema.body.definitions.step.properties.type.enum).toHaveLength(20);
  });
});
