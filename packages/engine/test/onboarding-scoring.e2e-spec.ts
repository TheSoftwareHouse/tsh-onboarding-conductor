import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { DataSource } from 'typeorm';

jest.setTimeout(30000);

const SCORING_WORKFLOW_ID = 'scoring';

/**
 * Drives the checked-in `scoring` fixture over HTTP, then reads the columns and audit rows the
 * journey wrote. The two journeys are the point: the same step graph clears a trusted applicant
 * without enhanced due diligence and routes a doubtful one into it.
 */
describe('Onboarding scoring (e2e)', () => {
  let app: NestExpressApplication | undefined;

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
      .send({ workflowId: SCORING_WORKFLOW_ID })
      .expect(201);

    return response.body.onboardingId as string;
  };

  // Submit carries no explicit @HttpCode, so Nest answers 201; sibling suites accept either.
  const submit = (onboardingId: string, body: Record<string, unknown>) =>
    http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(body)
      .expect((response) => expect([200, 201]).toContain(response.status));

  const readState = (onboardingId: string) =>
    http().get(`/v1/onboardings/${onboardingId}/state`).expect(200);

  const readAdmin = (onboardingId: string) =>
    http().get(`/v1/onboardings/${onboardingId}`).expect(200);

  beforeAll(async () => {
    process.env.CLIENT_WEBHOOK_BASE_URL = '';

    const { createApp } = await import('../src/main');
    const appBundle = await createApp();
    app = appBundle.app;
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('clears a trusted applicant without entering enhanced due diligence', async () => {
    const onboardingId = await startOnboarding();
    const steps: (string | null)[] = [];

    await submit(onboardingId, { country: 'PL' });
    steps.push((await readState(onboardingId)).body.currentStep);

    const final = await submit(onboardingId, { identityCode: 'VALID' });
    steps.push(final.body.currentStep);

    expect(steps).not.toContain('enhanced_due_diligence');
    expect(final.body.status).toBe('approved');

    const admin = await readAdmin(onboardingId);
    // collect_profile 3x10 = 30, verify_identity 2x5 = 10.
    expect(admin.body.score).toBe(40);
    expect(admin.body.scoreByStep).toEqual({ collect_profile: 30, verify_identity: 10 });
  });

  it('routes a lower-scoring applicant into enhanced due diligence', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { country: 'US' });
    const afterVerify = await submit(onboardingId, { identityCode: 'VALID' });

    expect(afterVerify.body.currentStep).toBe('enhanced_due_diligence');

    const admin = await readAdmin(onboardingId);
    // collect_profile 3x2 = 6, verify_identity 2x5 = 10.
    expect(admin.body.score).toBe(16);
  });

  it('scores a retried step once, at its most recent outcome', async () => {
    const onboardingId = await startOnboarding();

    await submit(onboardingId, { country: 'PL' });
    await submit(onboardingId, { identityCode: 'WRONG' });
    await submit(onboardingId, { resendRequested: true });
    await submit(onboardingId, { identityCode: 'WRONG' });
    await submit(onboardingId, { resendRequested: true });
    const passed = await submit(onboardingId, { identityCode: 'VALID' });

    expect(passed.body.status).toBe('approved');

    const dataSource = getApp().get(DataSource) as DataSource;
    const [row] = await dataSource.query(
      'SELECT score, score_by_step FROM onboardings WHERE id = $1',
      [onboardingId],
    );

    // Three attempts at verify_identity, one contribution: its passing outcome.
    expect(row.score_by_step).toEqual({
      collect_profile: 30,
      verify_identity: 10,
      resend_identity_code: 0,
    });
    expect(Number(row.score)).toBe(40);
  });

  it('keeps the score off the applicant-facing responses', async () => {
    const onboardingId = await startOnboarding();
    const submitted = await submit(onboardingId, { country: 'US' });

    expect(submitted.body).not.toHaveProperty('score');
    expect(submitted.body).not.toHaveProperty('scoreByStep');

    const state = await readState(onboardingId);

    expect(state.body).not.toHaveProperty('score');
    expect(state.body).not.toHaveProperty('scoreByStep');
    // Nor tucked inside the step descriptor the client renders from.
    expect(state.body.step).not.toHaveProperty('score');
    expect(
      (state.body.step?.fields ?? []).map((field: { name: string }) => field.name),
    ).not.toContain('$score');
  });

  it('records every delta, the running total, and the steps a move bypassed', async () => {
    const onboardingId = await startOnboarding();
    await submit(onboardingId, { country: 'PL' });
    await submit(onboardingId, { identityCode: 'VALID' });

    const dataSource = getApp().get(DataSource) as DataSource;
    const rows = await dataSource.query(
      `SELECT action, metadata
       FROM audit_log
       WHERE resource_type = 'onboarding' AND resource_id = $1
       ORDER BY occurred_at ASC, id ASC`,
      [onboardingId],
    );

    const transitions = rows.filter(
      (row: { action: string }) => row.action === 'onboarding.state_transition',
    );

    expect(
      transitions.map((row: { metadata: { scoreAfter: number } }) => row.metadata.scoreAfter),
    ).toEqual([30, 40]);
    expect(
      transitions.map((row: { metadata: { stepScore: number } }) => row.metadata.stepScore),
    ).toEqual([30, 10]);
    // The move that crossed the threshold names what it bypassed.
    expect(transitions[1].metadata.skippedSteps).toEqual(['enhanced_due_diligence']);
  });

  it('accepts a completion-date ordering and never returns a completed row after an empty one', async () => {
    // The null placement itself is pinned exactly by the repository unit test; this asserts the
    // endpoint accepts the column and that what comes back is partitioned the same way. The
    // assertion is deliberately an invariant rather than a count, so it does not depend on how
    // many onboardings the shared database has accumulated.
    const completed = await startOnboarding();
    await submit(completed, { country: 'PL' });
    await submit(completed, { identityCode: 'VALID' });

    const inFlight = await startOnboarding();
    await submit(inFlight, { country: 'US' });

    for (const sortDir of ['desc', 'asc'] as const) {
      const response = await http()
        .get('/v1/onboardings')
        .query({ workflowId: SCORING_WORKFLOW_ID, sortBy: 'completedAt', sortDir, limit: 100 })
        .expect(200);

      const completedFlags = (response.body.items as Array<{ completedAt: string | null }>).map(
        (item) => item.completedAt !== null,
      );

      // Every completed row precedes every empty one: `true`s first, then `false`s.
      const firstEmpty = completedFlags.indexOf(false);
      if (firstEmpty !== -1) {
        expect(completedFlags.slice(firstEmpty)).not.toContain(true);
      }
    }
  });

  it('filters and sorts the admin list by score', async () => {
    const lowScoring = await startOnboarding();
    await submit(lowScoring, { country: 'US' });

    const highScoring = await startOnboarding();
    await submit(highScoring, { country: 'PL' });

    const filtered = await http()
      .get('/v1/onboardings')
      .query({ workflowId: SCORING_WORKFLOW_ID, maxScore: 10, sortBy: 'score', sortDir: 'asc' })
      .expect(200);

    const ids = filtered.body.items.map((item: { onboardingId: string }) => item.onboardingId);
    expect(ids).toContain(lowScoring);
    expect(ids).not.toContain(highScoring);

    const scores = filtered.body.items.map((item: { score: number }) => item.score);
    expect([...scores]).toEqual([...scores].sort((a, b) => a - b));
  });
});
