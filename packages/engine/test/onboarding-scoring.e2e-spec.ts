import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

const SCORING_WORKFLOW_ID = 'scoring';
const COLLECT_PROFILE_STEP = 'collect_profile';
const REQUEST_CODE_STEP = 'request_code';
const MANUAL_REVIEW_STEP = 'manual_review';
const RISK_SCORE = 'risk';
const TRUST_SCORE = 'trust';

const EMAIL = 'scoring-fixture@example.com';
const EMAIL_TEMPLATE_ID = 'd-0123456789abcdef';

/**
 * `collect_profile` declares 19 required fields. `highRiskChannel` and `country` are the only two
 * that vary per scenario below; every other field is scored by nothing and carried unchanged so
 * neither scenario has to repeat all 19 fields twice. Neither scenario may drive `request_code`,
 * `verify_code`, `capture_*`, `submit_kyc` or `send_welcome`: those steps call Twilio, Sumsub and
 * SendGrid for real, and CI has no credentials for any of them.
 */
const BASE_PROFILE = {
  firstName: 'Ada',
  lastName: 'Lovelace',
  dateOfBirth: '1990-01-01',
  nationality: 'PL',
  street: 'Marszalkowska 1',
  town: 'Warsaw',
  postCode: '00-001',
  accountPurpose: 'salary',
  employmentStatus: 'employed',
  occupationGroup: 'isco_2',
  occupationTitle: 'Software Engineer',
  sourceOfFunds: 'salary',
  monthlyIncomingBand: '5k_15k',
  monthlyOutgoingBand: '1k_5k',
  pepSelfDeclared: false,
  email: EMAIL,
  emailTemplateId: EMAIL_TEMPLATE_ID,
};

/**
 * `country: 'RU'` matches the `in: ['RU', 'IR']` rule (+40), `highRiskChannel: true` matches its
 * own rule (+20), and the unconditional rule always fires (+5): 40 + 20 + 5 = 65 risk, which
 * crosses the fixture's `gte: 60` arm into `manual_review`. `country` is not `'PL'`, so the `trust`
 * rule on `collect_profile` never fires and `trust` stays at its declared `min` of 0.
 */
const HIGH_RISK_SUBMIT = { ...BASE_PROFILE, country: 'RU', highRiskChannel: true };
const EXPECTED_HIGH_RISK_SCORES = { [RISK_SCORE]: 65, [TRUST_SCORE]: 0 };

/**
 * `country: 'PL'` matches its own risk rule (-10) and the unconditional rule always fires (+5):
 * -10 + 5 = -5, clamped to the risk score's declared `min` of 0. Clamped `0` does not satisfy the
 * fixture's `gte: 60` arm, so the onboarding falls through to the unconditional fallback arm into
 * `request_code` — not a terminal status. `country: 'PL'` also matches the `trust` rule (+10).
 */
const LOW_RISK_SUBMIT = { ...BASE_PROFILE, country: 'PL', highRiskChannel: false };
const EXPECTED_LOW_RISK_SCORES = { [RISK_SCORE]: 0, [TRUST_SCORE]: 10 };

const EXPECTED_STARTING_SCORES = { [RISK_SCORE]: 0, [TRUST_SCORE]: 0 };

const originalAdminAuthEnabled = process.env.ADMIN_AUTH_ENABLED;

describe('Onboarding scoring (e2e)', () => {
  let app: NestExpressApplication | null = null;
  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  beforeAll(async () => {
    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
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
        .query('DELETE FROM audit_log WHERE resource_type = $1 AND resource_id = ANY($2::text[])', [
          'onboarding',
          Array.from(createdOnboardingIds),
        ]);
      await app
        .get(DataSource)
        .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
    }

    if (app) {
      await app.close();
    }

    if (originalAdminAuthEnabled === undefined) {
      delete process.env.ADMIN_AUTH_ENABLED;
    } else {
      process.env.ADMIN_AUTH_ENABLED = originalAdminAuthEnabled;
    }
  });

  const http = () => request(getApp().getHttpServer());

  const readOnboarding = async (id: string) => {
    const rows = await getApp()
      .get(DataSource)
      .query(
        `SELECT status, current_step, context, scores, completed_at
       FROM onboardings
       WHERE id = $1`,
        [id],
      );

    return rows[0] as {
      status: string;
      current_step: string | null;
      context: Record<string, unknown>;
      scores: Record<string, number>;
      completed_at: string | null;
    };
  };

  type AuditLogRow = {
    action: string;
    resource_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    metadata: Record<string, unknown>;
  };

  const readStateTransitionAuditRow = async (onboardingId: string): Promise<AuditLogRow> => {
    const rows = (await getApp()
      .get(DataSource)
      .query(
        `SELECT action, resource_id, before, after, metadata
       FROM audit_log
       WHERE resource_type = 'onboarding'
         AND resource_id = $1
         AND action = 'onboarding.state_transition'
       ORDER BY occurred_at ASC, id ASC`,
        [onboardingId],
      )) as AuditLogRow[];

    expect(rows).toHaveLength(1);
    return rows[0];
  };

  const startScoringOnboarding = async (): Promise<string> => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: SCORING_WORKFLOW_ID })
      .expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: COLLECT_PROFILE_STEP,
      expiresAt: null,
    });

    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);
    return onboardingId;
  };

  it('routes a high-risk submit to manual_review with the summed scores persisted and audited', async () => {
    const onboardingId = await startScoringOnboarding();

    const submitResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(HIGH_RISK_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(submitResponse.body).toEqual({
      appliedStep: COLLECT_PROFILE_STEP,
      status: 'awaiting_manual_review',
      currentStep: MANUAL_REVIEW_STEP,
      rejectionReason: null,
    });

    const onboarding = await readOnboarding(onboardingId);
    expect(onboarding.status).toBe('awaiting_manual_review');
    expect(onboarding.current_step).toBe(MANUAL_REVIEW_STEP);
    expect(onboarding.scores).toEqual(EXPECTED_HIGH_RISK_SCORES);
    expect(onboarding.completed_at).toBeNull();

    // `highRiskChannel` is declared `persist: false`: it drives the score but must not land in the
    // persisted context, even though it decided the branch taken.
    expect(onboarding.context).toEqual({ ...BASE_PROFILE, country: 'RU' });
    expect(onboarding.context).not.toHaveProperty('highRiskChannel');

    const auditRow = await readStateTransitionAuditRow(onboardingId);
    expect(auditRow.metadata).toEqual(
      expect.objectContaining({
        workflowId: SCORING_WORKFLOW_ID,
        appliedStep: COLLECT_PROFILE_STEP,
        fromStatus: 'awaiting_user',
        toStatus: 'awaiting_manual_review',
        fromScores: EXPECTED_STARTING_SCORES,
        toScores: EXPECTED_HIGH_RISK_SCORES,
      }),
    );
  });

  it('routes a low-risk submit to request_code with the risk score clamped at its declared min', async () => {
    const onboardingId = await startScoringOnboarding();

    const submitResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(LOW_RISK_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(submitResponse.body).toEqual({
      appliedStep: COLLECT_PROFILE_STEP,
      status: 'awaiting_user',
      currentStep: REQUEST_CODE_STEP,
      rejectionReason: null,
    });

    const onboarding = await readOnboarding(onboardingId);
    expect(onboarding.status).toBe('awaiting_user');
    expect(onboarding.current_step).toBe(REQUEST_CODE_STEP);
    expect(onboarding.scores).toEqual(EXPECTED_LOW_RISK_SCORES);
    expect(onboarding.completed_at).toBeNull();

    expect(onboarding.context).toEqual({ ...BASE_PROFILE, country: 'PL' });
    expect(onboarding.context).not.toHaveProperty('highRiskChannel');

    const auditRow = await readStateTransitionAuditRow(onboardingId);
    expect(auditRow.metadata).toEqual(
      expect.objectContaining({
        workflowId: SCORING_WORKFLOW_ID,
        appliedStep: COLLECT_PROFILE_STEP,
        fromStatus: 'awaiting_user',
        toStatus: 'awaiting_user',
        fromScores: EXPECTED_STARTING_SCORES,
        toScores: EXPECTED_LOW_RISK_SCORES,
      }),
    );
  });
});
