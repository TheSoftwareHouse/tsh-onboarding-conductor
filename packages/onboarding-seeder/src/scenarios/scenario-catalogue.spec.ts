import { RISK_REJECT_THRESHOLD, assessRisk } from '../workflow/risk-assessment';
import { COUNTRIES, STEPS } from '../workflow/analyst-investigation';
import { buildScenarioPlan } from './scenario-catalogue';

const SEED = 42;
const APPROVED_COUNT = 8;
const KEY_PATTERN = /^[a-z_-]+-\d{2}$/;

describe('buildScenarioPlan', () => {
  it('gives identical personal data and an identical plan for the same seed', () => {
    expect(buildScenarioPlan(SEED, APPROVED_COUNT)).toEqual(
      buildScenarioPlan(SEED, APPROVED_COUNT),
    );
  });

  it('gives different personal data for a different seed', () => {
    const first = buildScenarioPlan(SEED, APPROVED_COUNT).map(({ applicant }) => applicant);
    const second = buildScenarioPlan(SEED + 1, APPROVED_COUNT).map(({ applicant }) => applicant);

    expect(second).not.toEqual(first);
  });

  it('keys every scenario <family>-<nn>, uniquely', () => {
    const keys = buildScenarioPlan(SEED, APPROVED_COUNT).map(({ key }) => key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => KEY_PATTERN.test(key))).toBe(true);
  });

  it('covers every family the investigation scenarios rely on', () => {
    const families = new Set(buildScenarioPlan(SEED, APPROVED_COUNT).map(({ family }) => family));

    expect([...families].sort()).toEqual(
      [
        'approved',
        'score-reject',
        'verdict-reject',
        'review-waiting',
        'review-approved',
        'review-rejected',
        'review-invalid',
        'parked-awaiting',
        'parked-completed',
        'otp-exhausted',
        `abandoned-${STEPS.collectProfile}`,
        `abandoned-${STEPS.sendEmailCode}`,
        `abandoned-${STEPS.verifyEmailCode}`,
        `abandoned-${STEPS.uploadIdentityDocument}`,
        `abandoned-${STEPS.checkIdentity}`,
        'duplicate-applicant',
      ].sort(),
    );
  });

  it('seeds as many approved onboardings as asked', () => {
    const plans = buildScenarioPlan(SEED, 3);

    expect(plans.filter(({ family }) => family === 'approved')).toHaveLength(3);
  });

  it('generates synthetic contacts only: example.com emails, reserved phone numbers, valid countries', () => {
    for (const { applicant } of buildScenarioPlan(SEED, APPROVED_COUNT)) {
      expect(applicant.email).toMatch(/^[a-z0-9.]+@example\.com$/);
      expect(applicant.phoneNumber).toMatch(/^\+447700900\d{3}$/);
      expect(COUNTRIES).toContain(applicant.country);
      expect(COUNTRIES).toContain(applicant.nationality);
    }
  });

  it('gives every applicant a distinct email except the duplicate-applicant pair', () => {
    const plans = buildScenarioPlan(SEED, APPROVED_COUNT);
    const duplicates = plans.filter(({ family }) => family === 'duplicate-applicant');
    const others = plans.filter(({ family }) => family !== 'duplicate-applicant');
    const emails = others.map(({ applicant }) => applicant.email);

    expect(duplicates).toHaveLength(2);
    expect(duplicates[0].applicant.email).toBe(duplicates[1].applicant.email);
    expect(duplicates[0].applicant.phoneNumber).not.toBe(duplicates[1].applicant.phoneNumber);
    expect(new Set(emails).size).toBe(emails.length);
    expect(emails).not.toContain(duplicates[0].applicant.email);
  });

  it('rejects score-reject applicants and accepts every other profile at collect_profile', () => {
    for (const { family, applicant } of buildScenarioPlan(SEED, APPROVED_COUNT)) {
      expect(assessRisk(applicant).rejects).toBe(family === 'score-reject');
    }
  });

  it('names the step, the deciding signal and its value in a score rejection', () => {
    const [plan] = buildScenarioPlan(SEED, APPROVED_COUNT).filter(
      ({ family }) => family === 'score-reject',
    );
    const { score } = assessRisk(plan.applicant);

    expect(plan.expected).toMatchObject({ status: 'rejected', step: null, parked: false });
    expect(plan.expected.explanation).toContain(
      `rejected at ${STEPS.collectProfile}: risk ${score} ≥ ${RISK_REJECT_THRESHOLD}`,
    );
    expect(plan.expected.explanation).toContain('country');
  });

  it('expects a parked onboarding only where it waits on the identity provider', () => {
    const parked = buildScenarioPlan(SEED, APPROVED_COUNT)
      .filter(({ expected }) => expected.parked)
      .map(({ family }) => family);

    expect(new Set(parked)).toEqual(new Set(['parked-awaiting']));
  });

  it('holds back the callback of parked-completed onboardings only', () => {
    const deferred = buildScenarioPlan(SEED, APPROVED_COUNT)
      .filter(({ journey }) => journey.kind === 'identity-verdict' && journey.deferred)
      .map(({ family }) => family);

    expect(new Set(deferred)).toEqual(new Set(['parked-completed']));
  });

  it('explains every scenario with a non-empty answer', () => {
    for (const { expected } of buildScenarioPlan(SEED, APPROVED_COUNT)) {
      expect(expected.explanation.length).toBeGreaterThan(0);
    }
  });
});
