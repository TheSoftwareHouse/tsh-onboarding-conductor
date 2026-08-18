import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TwilioVerifyConnector } from '../src/connectors/adapters/production/twilio-verify.connector';
import { ConnectorExecutionResult } from '../src/connectors/ports/connector-execution-result';
import {
  stubProductionConnector,
  type ProductionConnectorStub,
} from './support/production-connector-stub';

const WORKFLOW_ID = 'twilio-verify';
const PHONE_NUMBER = '+15551234567';
const EXPECTED_CODE = '123456';

describe('Production connector stubbing (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let twilio: ProductionConnectorStub;
  let fetchSpy: jest.SpyInstance | undefined;

  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const http = () => request(getApp().getHttpServer());

  const startOnboarding = async (): Promise<string> => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: WORKFLOW_ID })
      .expect(201);
    const onboardingId = response.body.onboardingId as string;

    createdOnboardingIds.add(onboardingId);

    return onboardingId;
  };

  const submit = (onboardingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(body));

  const readOnboarding = async (onboardingId: string) => {
    const rows = (await getApp()
      .get(DataSource)
      .query('SELECT status, current_step FROM onboardings WHERE id = $1', [
        onboardingId,
      ])) as Array<{ status: string; current_step: string | null }>;

    return rows[0];
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.SANDBOX_CONNECTORS_ENABLED = 'true';
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
    // AppConfig demands these whatever the workflow does, but nothing reads them here: the stub
    // replaces the adapter that would have used them.
    process.env.TWILIO_ACCOUNT_SID = 'ACtest';
    process.env.TWILIO_AUTH_TOKEN = 'test-auth-token';
    process.env.TWILIO_VERIFY_SERVICE_SID = 'VA0000000000000000000000000000000';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    // The suite drives the shipped `twilio-verify` fixture unmodified — the point being that a
    // workflow declaring a production connector needs no test-specific variant. No user workflow
    // directory, so the fixtures are the only source.
    process.env.WORKFLOWS_DIR = '';
    process.env.FIXTURE_WORKFLOWS_ENABLED = 'true';

    const { AppModule } = await import('../src/app.module');

    const builder = Test.createTestingModule({ imports: [AppModule] });

    twilio = stubProductionConnector(builder, {
      provider: TwilioVerifyConnector,
      type: 'twilio_verify',
      execute: async ({ declaration, payload }) => {
        const operation = declaration.config.operation;

        if (operation === 'startVerification') {
          return ConnectorExecutionResult.accepted();
        }

        if (operation === 'checkVerification') {
          return payload.code === EXPECTED_CODE
            ? ConnectorExecutionResult.accepted()
            : ConnectorExecutionResult.rejected('CONNECTOR_REJECTED');
        }

        return ConnectorExecutionResult.invalid();
      },
    });

    const moduleFixture = await builder.compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    if (app && createdOnboardingIds.size > 0) {
      await app
        .get(DataSource)
        .query('DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
      await app
        .get(DataSource)
        .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
    }

    await app?.close();
  });

  beforeEach(() => {
    twilio.reset();
    // Nothing may reach Twilio: the whole point of the stub is that the provider stays untouched.
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    const twilioRequests = (fetchSpy?.mock.calls ?? []).filter((call) =>
      String(call[0]).includes('verify.twilio.com'),
    );

    expect(twilioRequests).toHaveLength(0);
    fetchSpy?.mockRestore();
  });

  it('drives a workflow declaring twilio_verify through the stub and approves it', async () => {
    const onboardingId = await startOnboarding();

    const requested = await submit(onboardingId, { phoneNumber: PHONE_NUMBER });
    expect([200, 201]).toContain(requested.status);
    expect(requested.body).toEqual(
      expect.objectContaining({ appliedStep: 'request_code', currentStep: 'verify_code' }),
    );

    const verified = await submit(onboardingId, { verificationCode: EXPECTED_CODE });
    expect([200, 201]).toContain(verified.status);
    expect(verified.body).toEqual(
      expect.objectContaining({
        appliedStep: 'verify_code',
        status: 'approved',
        currentStep: null,
      }),
    );

    expect(await readOnboarding(onboardingId)).toEqual({ status: 'approved', current_step: null });
  });

  it('receives the declaration and mapped payload the production adapter would have received', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { phoneNumber: PHONE_NUMBER });
    await submit(onboardingId, { verificationCode: EXPECTED_CODE });

    expect(twilio.calls).toHaveLength(2);

    const [start, check] = twilio.calls;
    expect(start.declaration.config).toEqual({ operation: 'startVerification' });
    expect(start.payload).toEqual({ recipient: PHONE_NUMBER });
    expect(start.execution).toEqual({
      onboardingId,
      stepName: 'request_code',
      workflowSource: 'fixtures',
    });

    expect(check.declaration.config).toEqual({ operation: 'checkVerification' });
    expect(check.payload).toEqual({ recipient: PHONE_NUMBER, code: EXPECTED_CODE });
  });

  it('lets the stub reject, driving the workflow down its rejected transition', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { phoneNumber: PHONE_NUMBER });
    const rejected = await submit(onboardingId, { verificationCode: '999999' });

    expect([200, 201]).toContain(rejected.status);
    expect(rejected.body).toEqual(
      expect.objectContaining({
        appliedStep: 'verify_code',
        status: 'rejected',
        currentStep: null,
      }),
    );

    expect(await readOnboarding(onboardingId)).toEqual({ status: 'rejected', current_step: null });
  });
});
