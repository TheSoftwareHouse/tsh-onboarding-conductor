import { readFileSync } from 'node:fs';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { BUILT_IN_WORKFLOWS_DIR } from '../src/workflows/workflow-roots';

const nodeGraph = JSON.parse(
  readFileSync(
    path.join(BUILT_IN_WORKFLOWS_DIR, 'eu-b2c-individual-kyc-eea-v2.workflow.json'),
    'utf8',
  ),
) as { nodes: Array<Record<string, unknown>>; sourceKey?: string };

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
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('compiles the built-in node graph and reports its steps, nodes and projection', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(nodeGraph)
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
    expect(response.body.nodes).toHaveLength(15);
    expect(response.body.nodes[8]).toMatchObject({
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

  it('refuses a broken graph with the reason and the path to the node at fault', async () => {
    // `collect_personal`, whose one port is `success`, loses its edge.
    const broken = {
      ...nodeGraph,
      nodes: nodeGraph.nodes.map((node, index) => (index === 2 ? { ...node, edges: {} } : node)),
    };

    const response = await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(broken)
      .expect(400);

    expect(response.body).toMatchObject({
      code: 'WORKFLOW_INVALID',
      message: 'WORKFLOW_INVALID',
      reason: 'INVALID_TRANSITIONS',
      path: 'nodes[2].edges.success',
    });
  });

  it("refuses a connector declaration the adapter rejects, in the adapter's words", async () => {
    // A GET carrying a body passes the DDL — the request is opaque config to it — and is the
    // `http_request` adapter's to refuse.
    const broken = {
      ...nodeGraph,
      nodes: nodeGraph.nodes.map((node) => {
        if (node.name !== 'provision_account') {
          return node;
        }

        const config = node.config as { request: Record<string, unknown> };

        return { ...node, config: { ...config, request: { ...config.request, method: 'GET' } } };
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
    const compiled = { ...nodeGraph, version: 99 };

    await request(app.getHttpServer())
      .post('/v1/admin/workflows/compile')
      .send(compiled)
      .expect(200);
    await request(app.getHttpServer())
      .get('/v1/admin/workflows/eu-b2c-individual-kyc-eea?version=99')
      .expect(404);
  });

  it('serves the palette and the node-graph schema a builder validates against', async () => {
    const palette = await request(app.getHttpServer()).get('/v1/admin/node-types').expect(200);

    expect(palette.body.nodeTypes).toHaveLength(19);
    expect(palette.body.nodeTypes.map((nodeType: { type: string }) => nodeType.type)).toEqual(
      expect.arrayContaining(['kyc-identity-verification', 'otp-verify', 'custom-step']),
    );
    expect(
      palette.body.nodeTypes.find((nodeType: { type: string }) => nodeType.type === 'terminal'),
    ).toMatchObject({
      category: 'terminal',
      composable: false,
      connectorTypes: [],
      configSchema: { required: ['outcome'] },
    });
    expect(
      palette.body.nodeTypes.find(
        (nodeType: { type: string }) => nodeType.type === 'kyc-identity-verification',
      ).connectorTypes,
    ).toEqual(['kyc']);

    const schema = await request(app.getHttpServer())
      .get('/v1/admin/node-types/schema')
      .expect(200);

    expect(schema.body).toMatchObject({ title: 'Onboarding workflow (node graph)' });
    expect(schema.body.definitions.node.properties.type.enum).toHaveLength(19);
  });
});
