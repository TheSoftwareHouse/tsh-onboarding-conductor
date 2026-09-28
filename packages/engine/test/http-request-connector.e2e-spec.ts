import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';

const WORKFLOW_ID = 'http-request-e2e';
const PROVIDER_TOKEN = 'e2e-provider-token';

type CapturedRequest = {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string | undefined>;
  body: unknown;
};

type ProviderResponse = {
  status: number;
  body?: unknown;
};

describe('HttpRequestConnector (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let providerServer: Server | undefined;
  let workflowsDir: string;

  const capturedRequests: CapturedRequest[] = [];
  const createdOnboardingIds = new Set<string>();
  let providerResponse: ProviderResponse = { status: 200, body: { status: 'OK' } };

  const readRawRequestBody = async (incoming: IncomingMessage): Promise<string> => {
    const chunks: Buffer[] = [];

    for await (const chunk of incoming) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks).toString('utf8');
  };

  const startProviderServer = async (): Promise<string> =>
    new Promise((resolve, reject) => {
      providerServer = createServer((incoming: IncomingMessage, response: ServerResponse) => {
        void readRawRequestBody(incoming).then((rawBody) => {
          const parsedUrl = new URL(incoming.url ?? '/', 'http://127.0.0.1');

          capturedRequests.push({
            method: incoming.method ?? '',
            path: parsedUrl.pathname,
            query: Object.fromEntries(parsedUrl.searchParams.entries()),
            headers: incoming.headers as Record<string, string | undefined>,
            body: rawBody.length > 0 ? JSON.parse(rawBody) : undefined,
          });

          response.statusCode = providerResponse.status;

          if (providerResponse.body === undefined) {
            response.end();
            return;
          }

          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(providerResponse.body));
        });
      });

      providerServer.once('error', reject);
      providerServer.listen(0, '127.0.0.1', () => {
        const address = providerServer?.address();

        if (!address || typeof address === 'string') {
          reject(new Error('Unable to resolve provider server address'));
          return;
        }

        resolve(`http://127.0.0.1:${address.port}`);
      });
    });

  const writeWorkflow = (directory: string) => {
    writeFileSync(
      path.join(directory, 'http-request.workflow.json'),
      JSON.stringify({
        id: WORKFLOW_ID,
        version: 1,
        initial: 'collect_customer',
        steps: [
          {
            name: 'collect_customer',
            type: 'http-call',
            config: {
              connector: { name: 'customer_registration' },
              request: {
                method: 'POST',
                url: '{{secrets.e2eProvider.baseUrl}}/v1/customers',
                headers: { Authorization: 'Bearer {{secrets.e2eProvider.token}}' },
                query: { onboarding: '{{execution.onboardingId}}', locale: 'en' },
                body: {
                  email: '{{payload.customerEmail}}',
                  age: '{{payload.customerAge}}',
                  step: '{{execution.stepName}}',
                },
              },
              response: { errorsPath: 'errors' },
              fieldMapping: { customerEmail: 'email', customerAge: 'age' },
            },
            include: [
              {
                type: 'form',
                config: {
                  fields: {
                    email: { type: 'text', required: true, validation: { format: 'email' } },
                    age: { type: 'number', required: true, validation: { minimum: 18 } },
                  },
                },
              },
            ],
            edges: { success: 'approved' },
          },
          { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
        ],
      }),
    );
  };

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
    const providerBaseUrl = await startProviderServer();

    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-http-connector-workflows-'));
    writeWorkflow(workflowsDir);

    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
    // Sibling suites in this process point this at a live server of their own, so it is reset
    // rather than inherited; everything else comes from .env.
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;
    process.env.HTTP_CONNECTOR_SECRETS = JSON.stringify({
      e2eProvider: { baseUrl: providerBaseUrl, token: PROVIDER_TOKEN },
    });

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({ bodyParser: false });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(app);
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

    // Startup published this throwaway workflow into the shared workflows table;
    // leaving it there would break every later boot that lacks its provider secret.
    if (app) {
      await app.get(DataSource).query('DELETE FROM workflows WHERE key = $1', [WORKFLOW_ID]);
    }

    await app?.close();

    if (providerServer?.listening) {
      await new Promise<void>((resolve, reject) => {
        providerServer?.close((error) => (error ? reject(error) : resolve()));
      });
    }

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  beforeEach(() => {
    capturedRequests.length = 0;
    providerResponse = { status: 200, body: { status: 'OK' } };
  });

  it('sends the declared request to the provider and advances the onboarding', async () => {
    const onboardingId = await startOnboarding();

    const response = await submit(onboardingId, { email: 'user@example.com', age: 42 });

    expect([200, 201]).toContain(response.status);
    expect(response.body).toEqual(
      expect.objectContaining({
        appliedStep: 'collect_customer',
        status: 'approved',
        currentStep: null,
      }),
    );

    expect(capturedRequests).toHaveLength(1);
    const [captured] = capturedRequests;
    expect(captured.method).toBe('POST');
    expect(captured.path).toBe('/v1/customers');
    expect(captured.query).toEqual({ onboarding: onboardingId, locale: 'en' });
    expect(captured.headers.authorization).toBe(`Bearer ${PROVIDER_TOKEN}`);
    expect(captured.headers['content-type']).toBe('application/json');
    expect(captured.body).toEqual({
      email: 'user@example.com',
      age: 42,
      step: 'collect_customer',
    });

    expect(await readOnboarding(onboardingId)).toEqual({ status: 'approved', current_step: null });
  });

  it('maps a provider 4xx onto step field errors and lets the user resubmit', async () => {
    const onboardingId = await startOnboarding();
    providerResponse = { status: 422, body: { errors: { customerEmail: ['ALREADY_REGISTERED'] } } };

    const rejected = await submit(onboardingId, { email: 'taken@example.com', age: 42 }).expect(
      400,
    );

    expect(rejected.body).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
      errors: { email: ['ALREADY_REGISTERED'] },
    });
    expect(await readOnboarding(onboardingId)).toEqual({
      status: 'awaiting_user',
      current_step: 'collect_customer',
    });

    providerResponse = { status: 200, body: { status: 'OK' } };
    const accepted = await submit(onboardingId, { email: 'free@example.com', age: 42 });

    expect([200, 201]).toContain(accepted.status);
    expect(capturedRequests).toHaveLength(2);
    expect(await readOnboarding(onboardingId)).toEqual({ status: 'approved', current_step: null });
  });

  it('fails the submission and keeps the step when the provider errors', async () => {
    const onboardingId = await startOnboarding();
    providerResponse = { status: 503, body: { message: 'unavailable' } };

    await submit(onboardingId, { email: 'user@example.com', age: 42 }).expect(500);

    expect(capturedRequests).toHaveLength(1);
    expect(await readOnboarding(onboardingId)).toEqual({
      status: 'awaiting_user',
      current_step: 'collect_customer',
    });
  });
});
