import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';

// The fixture workflow on `mock_credit`: applicant -> credit_consent -> credit_check.
const MOCK_CREDIT_CALLBACK = '/v1/webhooks/mock_credit/callback';

interface View {
  phase: string;
  step: string | null;
  decision?: string;
  data: Record<string, unknown>;
  accounts?: Array<{ bankName: string }>;
}

describe('BNPL journey (e2e)', () => {
  let app: NestExpressApplication;
  let bff: string;
  let engine: string;

  const call = async (method: string, url: string, body?: unknown) => {
    const response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();

    return { status: response.status, body: text ? JSON.parse(text) : undefined };
  };

  const createSession = async (persona: string) => {
    const { status, body } = await call('POST', `${bff}/v1/bnpl/sessions`, { persona });
    expect(status).toBe(201);

    const session = body as { token: string; persona: string };
    const ids = await call('GET', `${bff}/v1/bnpl/sessions/${session.token}/onboarding`);
    expect(ids.status).toBe(200);

    return { ...session, onboardingId: (ids.body as { onboardingId: string }).onboardingId };
  };

  const view = async (token: string, wait?: number): Promise<View> => {
    const suffix = wait === undefined ? '' : `?wait=${wait}`;
    const { status, body } = await call('GET', `${bff}/v1/bnpl/sessions/${token}${suffix}`);
    expect(status).toBe(200);

    return body as View;
  };

  const submit = (token: string, values: Record<string, unknown>) =>
    call('POST', `${bff}/v1/bnpl/sessions/${token}/submit`, { values });

  const runToProcessing = async (token: string) => {
    expect((await submit(token, applicant)).status).toBe(200);
    expect((await submit(token, consent)).status).toBe(200);
    const run = await call('POST', `${bff}/v1/bnpl/sessions/${token}/run`);
    expect(run).toEqual({ status: 200, body: { phase: 'processing' } });
  };

  const postMockCallback = (onboardingId: string) =>
    call('POST', `${engine}${MOCK_CREDIT_CALLBACK}`, {
      onboardingId,
      providerReference: `mock:${onboardingId}:1`,
    });

  const applicant = { firstName: 'Test', lastName: 'Applicant', email: 'test@example.com' };
  const consent = { openBankingCreditCheckVersion: '2026-10', openBankingCreditCheckConsent: true };

  beforeAll(async () => {
    engine = process.env.ENGINE_BASE_URL as string;
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.listen(0, '127.0.0.1');
    bff = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  });

  afterAll(async () => {
    await app?.close();
  });

  it('walks Sherlock from collect to an approved result once the provider calls back', async () => {
    const session = await createSession('sherlock_holmes');
    expect(session.persona).toBe('sherlock_holmes');

    const collecting = await view(session.token);
    expect(collecting.phase).toBe('collect');
    expect(collecting.step).toBe('applicant');

    await runToProcessing(session.token);

    const processing = await view(session.token, 1);
    expect(processing.phase).toBe('processing');

    expect((await postMockCallback(session.onboardingId)).status).toBeLessThan(300);

    const result = await view(session.token, 25);
    expect(result.phase).toBe('result');
    expect(result.decision).toBe('approved');
    expect(result.data.creditScore).toBe(965);
    expect(result.data.creditReport).toEqual(
      expect.objectContaining({ scores: expect.anything() }),
    );
    expect(result.accounts?.[0].bankName).toBe('Algoan Demo');
  });

  it('resolves two concurrent sessions independently', async () => {
    const [sherlock, watson] = await Promise.all([
      createSession('sherlock_holmes'),
      createSession('james_watson'),
    ]);
    expect(sherlock.token).not.toBe(watson.token);
    expect(sherlock.onboardingId).not.toBe(watson.onboardingId);

    await Promise.all([runToProcessing(sherlock.token), runToProcessing(watson.token)]);
    await postMockCallback(watson.onboardingId);
    await postMockCallback(sherlock.onboardingId);

    const [sherlockResult, watsonResult] = await Promise.all([
      view(sherlock.token, 25),
      view(watson.token, 25),
    ]);
    expect(sherlockResult).toEqual(
      expect.objectContaining({ phase: 'result', decision: 'approved' }),
    );
    expect(sherlockResult.data.creditScore).toBe(965);
    expect(watsonResult).toEqual(expect.objectContaining({ phase: 'result', decision: 'review' }));
    expect(watsonResult.data.creditScore).toBe(598);
  });

  it('answers an unknown token with 404 SESSION_NOT_FOUND', async () => {
    const response = await call('GET', `${bff}/v1/bnpl/sessions/unknown-token`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).toContain('SESSION_NOT_FOUND');
  });

  it('wakes a waiting long-poll when the engine webhook names the onboarding', async () => {
    const session = await createSession('sherlock_holmes');
    await runToProcessing(session.token);

    const started = Date.now();
    const waiting = view(session.token, 10);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await postMockCallback(session.onboardingId);
    const hook = await call('POST', `${bff}/v1/bnpl/webhooks/engine`, {
      onboarding: { id: session.onboardingId },
    });
    const result = await waiting;

    expect(hook.status).toBe(204);
    expect(result.phase).toBe('result');
    expect(Date.now() - started).toBeLessThan(5000);
  });
});
