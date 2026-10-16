import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { SmtpEmailOtpConnector } from '../src/connectors/adapters/built-in/smtp-email-otp.connector';
import { startE2eServer } from './e2e-server';

/**
 * Runs the real `smtp_email_otp` connector — `CONNECTOR_MOCKS` is emptied in `beforeAll` — with delivery
 * through the SMTP connector to MailHog, and reads the code back from MailHog's API. Like
 * `smtp.e2e-spec.ts`, it runs only inside the `pnpm test:mailhog:integration` flow, because the
 * MailHog SMTP port is reachable from the Compose network alone.
 */
const MAILHOG_API_URL = process.env.MAILHOG_API_URL ?? 'http://mailhog:8025/api/v1/messages';
const WORKFLOW_ID = 'otp-email-typed';
const EMAIL = 'otp-person@example.com';
const OTP_MAX_SENDS = 5;
const CODE_PATTERN = /\b(\d{6})\b/;
/** `pg`'s default pool size, which the engine's main pool keeps. */
const PG_DEFAULT_POOL_SIZE = 10;
const EXHAUSTED_POOL_TIMEOUT_MS = 30000;
/** Right by chance one time in a million; the exhausted-pool case only needs it refused. */
const WRONG_CODE = '000000';

const OTP_INVALID_DATA = {
  code: 'INVALID_STEP_DATA',
  message: 'INVALID_STEP_DATA',
  errors: { verificationCode: ['INVALID'] },
};

type MailHogMessage = {
  Content: { Headers: Record<string, string[]>; Body: string };
};

type ChallengeRow = {
  code_hash: string;
  code_salt: string;
  send_count: number;
  attempts: number;
};

const clearMessages = async (): Promise<void> => {
  const response = await fetch(MAILHOG_API_URL, { method: 'DELETE' });
  expect(response.ok).toBe(true);
};

const getMessages = async (): Promise<MailHogMessage[]> => {
  const response = await fetch(MAILHOG_API_URL);
  expect(response.ok).toBe(true);
  const body = (await response.json()) as MailHogMessage[] | { items: MailHogMessage[] };
  return Array.isArray(body) ? body : body.items;
};

describe('OTP connector over email (e2e)', () => {
  let app: NestExpressApplication | undefined;
  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  const http = () => request(getApp().getHttpServer());
  const dataSource = (): DataSource => getApp().get(DataSource);

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
    http().post(`/v1/onboardings/${onboardingId}/submit`).send(body);

  /** The one message MailHog holds, whose code the test cannot learn any other way. */
  const readMailedCode = async (): Promise<string> => {
    const messages = await getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].Content.Headers.To[0]).toContain(EMAIL);
    const match = CODE_PATTERN.exec(messages[0].Content.Body);
    expect(match).not.toBeNull();
    return (match as RegExpExecArray)[1];
  };

  const readChallenges = (onboardingId: string): Promise<ChallengeRow[]> =>
    dataSource().query<ChallengeRow[]>(
      'SELECT code_hash, code_salt, send_count, attempts FROM otp_challenges WHERE onboarding_id = $1',
      [onboardingId],
    );

  const expireChallenge = async (onboardingId: string): Promise<void> => {
    await dataSource().query(
      "UPDATE otp_challenges SET expires_at = now() - interval '1 second' WHERE onboarding_id = $1",
      [onboardingId],
    );
  };

  beforeAll(async () => {
    // The real connector must run: no mock may stand in for `smtp_email_otp` whatever .env says.
    process.env.CONNECTOR_MOCKS = '';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { createApp } = await import('../src/main');

    const appBundle = await createApp();
    app = appBundle.app;
    await startE2eServer(app);
  }, 60000);

  afterAll(async () => {
    if (app && createdOnboardingIds.size > 0) {
      const ids = Array.from(createdOnboardingIds);
      await dataSource().query(
        'DELETE FROM client_webhook_outbox WHERE onboarding_id = ANY($1::uuid[])',
        [ids],
      );
      await dataSource().query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [ids]);
    }

    await app?.close();
  });

  beforeEach(async () => {
    await clearMessages();
  });

  afterEach(async () => {
    await clearMessages();
  });

  it('mails a code, refuses a wrong one, approves the right one and deletes the challenge', async () => {
    const onboardingId = await startOnboarding();

    const requested = await submit(onboardingId, { email: EMAIL });
    expect([200, 201]).toContain(requested.status);
    expect(requested.body).toEqual({
      appliedStep: 'request_code',
      status: 'awaiting_user',
      currentStep: 'verify_code',
      rejectionReason: null,
    });

    const mailedCode = await readMailedCode();

    const [challenge] = await readChallenges(onboardingId);
    expect(challenge.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(challenge.code_salt).toHaveLength(32);
    expect(JSON.stringify(challenge)).not.toContain(mailedCode);

    const wrongCode = mailedCode === '000000' ? '111111' : '000000';
    const invalid = await submit(onboardingId, { verificationCode: wrongCode }).expect(400);
    expect(invalid.body).toEqual(OTP_INVALID_DATA);
    expect((await readChallenges(onboardingId))[0].attempts).toBe(1);

    const verified = await submit(onboardingId, { verificationCode: mailedCode });
    expect([200, 201]).toContain(verified.status);
    expect(verified.body).toEqual({
      appliedStep: 'verify_code',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(await readChallenges(onboardingId)).toHaveLength(0);

    const [onboarding] = await dataSource().query<Array<{ status: string; context: unknown }>>(
      'SELECT status, context FROM onboardings WHERE id = $1',
      [onboardingId],
    );
    expect(onboarding.status).toBe('approved');
    expect(JSON.stringify(onboarding.context)).not.toContain(mailedCode);
  });

  it('rejects the onboarding on the sixth send of one challenge with ATTEMPTS_EXHAUSTED', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { email: EMAIL }).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );

    // Each further send is the resend step the expiry route leads to.
    for (let send = 2; send <= OTP_MAX_SENDS; send += 1) {
      await expireChallenge(onboardingId);
      const expired = await submit(onboardingId, { verificationCode: '123456' });
      expect(expired.body).toMatchObject({
        status: 'awaiting_user',
        currentStep: 'request_code_resend',
      });
      await submit(onboardingId, {}).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );
    }

    expect((await readChallenges(onboardingId))[0].send_count).toBe(OTP_MAX_SENDS);

    await expireChallenge(onboardingId);
    await submit(onboardingId, { verificationCode: '123456' });
    const refused = await submit(onboardingId, {});
    expect([200, 201]).toContain(refused.status);
    expect(refused.body).toEqual({
      appliedStep: 'request_code_resend',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'ATTEMPTS_EXHAUSTED',
    });
    expect((await readChallenges(onboardingId))[0].send_count).toBe(OTP_MAX_SENDS);
  });

  it('routes an expired challenge to the resend step, where a new code works', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { email: EMAIL }).expect((response) =>
      expect([200, 201]).toContain(response.status),
    );
    const firstCode = await readMailedCode();
    await clearMessages();

    await expireChallenge(onboardingId);

    const expired = await submit(onboardingId, { verificationCode: firstCode });
    expect([200, 201]).toContain(expired.status);
    expect(expired.body).toEqual({
      appliedStep: 'verify_code',
      status: 'awaiting_user',
      currentStep: 'request_code_resend',
      rejectionReason: null,
    });

    const resent = await submit(onboardingId, {});
    expect([200, 201]).toContain(resent.status);
    expect(resent.body).toMatchObject({ currentStep: 'verify_code' });

    const secondCode = await readMailedCode();
    const verified = await submit(onboardingId, { verificationCode: secondCode });
    expect([200, 201]).toContain(verified.status);
    expect(verified.body).toMatchObject({ status: 'approved' });
    expect(await readChallenges(onboardingId)).toHaveLength(0);
  });

  // A submit holds one main-pool connection for its transaction while the connector runs. Were the
  // challenge read from that same pool, enough concurrent submits would each wait for a connection
  // none of them releases, and the engine would hang for good. Holding every main-pool connection
  // here stands in for those submits: the check must still answer.
  it(
    'checks a code while every main-pool connection is held',
    async () => {
      const onboardingId = await startOnboarding();
      await submit(onboardingId, { email: EMAIL }).expect((response) =>
        expect([200, 201]).toContain(response.status),
      );

      const heldConnections = Array.from({ length: PG_DEFAULT_POOL_SIZE }, () =>
        dataSource().createQueryRunner(),
      );
      await Promise.all(heldConnections.map((runner) => runner.connect()));
      try {
        const result = await getApp()
          .get(SmtpEmailOtpConnector)
          .execute({
            declaration: { order: 0, config: { operation: 'check', channel: 'email' } },
            execution: { onboardingId, stepName: 'verify_code' },
            context: {},
            payload: { recipient: EMAIL, code: WRONG_CODE },
            payloadFieldSources: { recipient: 'email', code: 'verificationCode' },
          });

        expect(result.isInvalidData()).toBe(true);
      } finally {
        await Promise.all(heldConnections.map((runner) => runner.release()));
      }

      expect((await readChallenges(onboardingId))[0].attempts).toBe(1);
    },
    EXHAUSTED_POOL_TIMEOUT_MS,
  );
});
