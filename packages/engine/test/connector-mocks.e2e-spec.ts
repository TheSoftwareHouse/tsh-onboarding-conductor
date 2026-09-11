import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { MockEmailDeliveryConnector } from '../src/connectors/adapters/fixtures/mock-email-delivery.connector';
import { MockPhoneVerificationConnector } from '../src/connectors/adapters/fixtures/mock-verification.connector';
import { startE2eServer } from './e2e-server';

// The twilio-verify and sendgrid-email workflows ship in workflows/fixtures/ and are used
// exactly as they are: they declare the production connectors and know nothing about the
// capability mocks standing in for them.
const TWILIO_WORKFLOW_ID = 'twilio-verify';
const SENDGRID_WORKFLOW_ID = 'sendgrid-email';
const ASYNC_WORKFLOW_ID = 'connector-mocks-async';
const PHONE_NUMBER = '+15551234567';
const RECIPIENT = 'person@example.com';
const TEMPLATE_ID = 'd-e2e-template';

/**
 * No built-in connector supports callbacks yet, so the async round trip runs on the phone
 * verification mock's own connector type, which does. The moment a callback-capable provider
 * ships, the same mock serves it bound to that provider instead.
 */
const writeAsyncWorkflow = (directory: string) => {
  writeFileSync(
    path.join(directory, 'connector-mocks-async.workflow.json'),
    JSON.stringify({
      id: ASYNC_WORKFLOW_ID,
      version: 1,
      name: 'Async phone verification',
      initial: 'request_code',
      steps: [
        {
          name: 'request_code',
          type: 'connector-call',
          config: {
            fields: {
              phoneNumber: { type: 'text', required: true, validation: { format: 'phone' } },
            },
            connectors: [
              {
                name: 'phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                order: 1,
                fieldMapping: { recipient: 'phoneNumber' },
                config: { operation: 'challenge' },
              },
            ],
          },
          edges: { success: 'verify_code' },
        },
        {
          name: 'verify_code',
          type: 'connector-call',
          config: {
            fields: {
              verificationCode: {
                type: 'text',
                required: true,
                persist: false,
                validation: { minLength: 1 },
              },
            },
            connectors: [
              {
                name: 'phone_verification',
                id: 'mock_phone_verification',
                type: 'phone_verification',
                order: 1,
                async: true,
                canReject: true,
                fieldMapping: { recipient: 'phoneNumber', code: 'verificationCode' },
                config: { operation: 'verify' },
              },
            ],
          },
          edges: { success: 'approved', rejected: 'rejected' },
        },
        { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
        { name: 'rejected', type: 'terminal', config: { outcome: 'rejected' } },
      ],
    }),
  );
};

describe('Connector mocks (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let workflowsDir: string | undefined;
  let fetchSpy: jest.SpyInstance | undefined;

  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const http = () => request(getApp().getHttpServer());

  const verificationMock = (): MockPhoneVerificationConnector =>
    getApp().get(MockPhoneVerificationConnector);

  const deliveryMock = (): MockEmailDeliveryConnector => getApp().get(MockEmailDeliveryConnector);

  const startOnboarding = async (workflowId: string): Promise<string> => {
    const response = await http().post('/v1/onboardings').send({ workflowId }).expect(201);
    const onboardingId = response.body.onboardingId as string;

    createdOnboardingIds.add(onboardingId);

    return onboardingId;
  };

  const submit = (onboardingId: string, body: Record<string, unknown>) =>
    http().post(`/v1/onboardings/${onboardingId}/submit`).send(body);

  const postProviderCallback = (providerKey: string, rawBody: Uint8Array) =>
    http()
      .post(`/v1/webhooks/${providerKey}/callback`)
      .set('content-type', 'application/json')
      .send(Buffer.from(rawBody).toString('utf8'));

  const readOnboarding = async (onboardingId: string) => {
    const rows = (await getApp()
      .get(DataSource)
      .query('SELECT status, current_step FROM onboardings WHERE id = $1', [
        onboardingId,
      ])) as Array<{ status: string; current_step: string | null }>;

    return rows[0];
  };

  beforeAll(async () => {
    workflowsDir = mkdtempSync(path.join(tmpdir(), 'engine-connector-mocks-workflows-'));
    writeAsyncWorkflow(workflowsDir);

    // Sibling suites in this process point this at a live server of their own, so it is reset
    // rather than inherited; everything else comes from .env.
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = workflowsDir;
    // Placeholders: config validation still demands them, but nothing reads them once the
    // mocks are serving, and no provider account backs these values.

    const { createApp } = await import('../src/main');

    const appBundle = await createApp();
    app = appBundle.app;
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

    // Startup published this throwaway workflow into the shared workflows table.
    if (app) {
      await app
        .get(DataSource)
        .query('DELETE FROM workflows WHERE workflow_id = $1', [ASYNC_WORKFLOW_ID]);
    }

    await app?.close();

    if (workflowsDir) {
      rmSync(workflowsDir, { recursive: true, force: true });
    }
  });

  const resetMocks = () => {
    verificationMock().__resetForTests();
    deliveryMock().__resetForTests();
  };

  beforeEach(() => {
    resetMocks();
    fetchSpy = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    resetMocks();
  });

  const providerCalls = (host: string): unknown[] =>
    (fetchSpy?.mock.calls ?? []).filter(([target]) => String(target).includes(host));

  describe('standing in for a synchronous connector', () => {
    it('runs the unchanged twilio_verify workflow against the phone verification mock', async () => {
      const onboardingId = await startOnboarding(TWILIO_WORKFLOW_ID);

      const requested = await submit(onboardingId, { phoneNumber: PHONE_NUMBER });

      expect([200, 201]).toContain(requested.status);
      expect(requested.body).toEqual({
        appliedStep: 'request_code',
        status: 'awaiting_user',
        currentStep: 'verify_code',
        rejectionReason: null,
      });

      const issuedCode = verificationMock().__peekCodeForTests(onboardingId);
      expect(issuedCode).toMatch(/^\d{6}$/);

      const verified = await submit(onboardingId, { verificationCode: issuedCode });

      expect([200, 201]).toContain(verified.status);
      expect(verified.body).toEqual({
        appliedStep: 'verify_code',
        status: 'approved',
        currentStep: null,
        rejectionReason: null,
      });

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'approved',
        current_step: null,
      });
      expect(providerCalls('twilio.com')).toHaveLength(0);
    });

    it('keeps the provider contract for a wrong code, so the user can retry', async () => {
      const onboardingId = await startOnboarding(TWILIO_WORKFLOW_ID);

      await submit(onboardingId, { phoneNumber: PHONE_NUMBER }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      const issuedCode = verificationMock().__peekCodeForTests(onboardingId);
      const rejected = await submit(onboardingId, { verificationCode: '000000' }).expect(400);

      expect(rejected.body).toEqual({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      });
      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'awaiting_user',
        current_step: 'verify_code',
      });

      await submit(onboardingId, { verificationCode: issuedCode }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'approved',
        current_step: null,
      });
      expect(providerCalls('twilio.com')).toHaveLength(0);
    });

    it('runs the unchanged sendgrid_email workflow against the delivery mock, sending nothing', async () => {
      const onboardingId = await startOnboarding(SENDGRID_WORKFLOW_ID);

      const response = await submit(onboardingId, {
        email: RECIPIENT,
        emailTemplateId: TEMPLATE_ID,
        firstName: 'Ada',
        accountReference: 'ACC-1',
        companyName: 'Example Ltd',
      });

      expect([200, 201]).toContain(response.status);
      expect(response.body).toEqual(
        expect.objectContaining({ appliedStep: 'send_email', status: 'approved' }),
      );

      expect(deliveryMock().__peekDeliveredEmailsForTests(onboardingId)).toEqual([
        {
          onboardingId,
          stepName: 'send_email',
          recipient: RECIPIENT,
          templateId: TEMPLATE_ID,
          data: {
            first_name: 'Ada',
            account_reference: 'ACC-1',
            company_name: 'Example Ltd',
          },
        },
      ]);

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'approved',
        current_step: null,
      });
      expect(providerCalls('sendgrid')).toHaveLength(0);
    });

    it('keeps the sendgrid_email field validation, so a bad template id never reaches delivery', async () => {
      const onboardingId = await startOnboarding(SENDGRID_WORKFLOW_ID);

      const rejected = await submit(onboardingId, {
        email: RECIPIENT,
        emailTemplateId: 'not-a-sendgrid-template',
        firstName: 'Ada',
        accountReference: 'ACC-1',
        companyName: 'Example Ltd',
      }).expect(400);

      expect(rejected.body).toEqual({
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { emailTemplateId: ['INVALID'] },
      });
      expect(deliveryMock().__peekDeliveredEmailsForTests(onboardingId)).toHaveLength(0);
      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'awaiting_user',
        current_step: 'send_email',
      });
    });
  });

  describe('serving an asynchronous declaration', () => {
    const startAsyncVerification = async (): Promise<string> => {
      const onboardingId = await startOnboarding(ASYNC_WORKFLOW_ID);

      await submit(onboardingId, { phoneNumber: PHONE_NUMBER }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      return onboardingId;
    };

    it('parks the step until the provider callback approves it', async () => {
      const onboardingId = await startAsyncVerification();
      const mock = verificationMock();
      const issuedCode = mock.__peekCodeForTests(onboardingId);

      const parked = await submit(onboardingId, { verificationCode: issuedCode });

      // The step neither advances nor fails: the engine holds it until the provider reports.
      expect([200, 201]).toContain(parked.status);
      expect(parked.body).toEqual({
        appliedStep: 'verify_code',
        status: 'awaiting_user',
        currentStep: 'verify_code',
        rejectionReason: null,
      });
      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'awaiting_user',
        current_step: 'verify_code',
      });

      // What the provider was handed, rather than a verdict it has not given yet.
      const initiation = mock.__peekInitiationForTests(onboardingId);
      expect(initiation?.detail).toEqual({ operation: 'verify', code: issuedCode });

      // Resuming replays the step, so the provider echoes the data the step collected.
      const callback = mock.__buildProviderCallbackForTests({
        providerReference: initiation?.providerReference,
        submittedData: { verificationCode: issuedCode },
      });
      await postProviderCallback('mock_phone_verification', callback.rawBody).expect(204);

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'approved',
        current_step: null,
      });
    });

    it('leaves the user able to retry when the callback reports a wrong code', async () => {
      const onboardingId = await startAsyncVerification();
      const mock = verificationMock();
      const issuedCode = mock.__peekCodeForTests(onboardingId);

      await submit(onboardingId, { verificationCode: '000000' }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      const wrongInitiation = mock.__peekInitiationForTests(onboardingId);
      const wrongCallback = mock.__buildProviderCallbackForTests({
        providerReference: wrongInitiation?.providerReference,
        submittedData: { verificationCode: '000000' },
      });
      // Resuming with a wrong code is a failed submission, so the callback itself is refused.
      await postProviderCallback('mock_phone_verification', wrongCallback.rawBody).expect(400);

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'awaiting_user',
        current_step: 'verify_code',
      });

      await submit(onboardingId, { verificationCode: issuedCode }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );
      const retryInitiation = mock.__peekInitiationForTests(onboardingId);
      const retryCallback = mock.__buildProviderCallbackForTests({
        providerReference: retryInitiation?.providerReference,
        submittedData: { verificationCode: issuedCode },
      });
      await postProviderCallback('mock_phone_verification', retryCallback.rawBody).expect(204);

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'approved',
        current_step: null,
      });
    });

    it('routes a terminal provider rejection to the rejected step', async () => {
      const onboardingId = await startAsyncVerification();
      const mock = verificationMock();
      const issuedCode = mock.__peekCodeForTests(onboardingId);

      await submit(onboardingId, { verificationCode: issuedCode }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      const initiation = mock.__peekInitiationForTests(onboardingId);
      const callback = mock.__buildProviderCallbackForTests({
        providerReference: initiation?.providerReference,
        submittedData: { verificationCode: issuedCode },
        status: 'rejected',
        reason: 'ATTEMPTS_EXHAUSTED',
      });

      await postProviderCallback('mock_phone_verification', callback.rawBody).expect(204);

      expect(await readOnboarding(onboardingId)).toEqual({
        status: 'rejected',
        current_step: null,
      });
    });

    it('fails the callback when the provider reference correlates to nothing', async () => {
      const mock = verificationMock();
      const callback = mock.__buildProviderCallbackForTests({
        providerReference: 'never-initiated',
      });

      // Same shape as any other mapping failure: refused, and nothing resumes.
      await postProviderCallback('mock_phone_verification', callback.rawBody).expect(500);
    });
  });
});
