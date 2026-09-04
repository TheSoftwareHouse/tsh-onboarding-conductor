import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evaluateCondition, validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import { Scoring } from './domain/scoring';

const scoringWorkflowPath = resolve(
  __dirname,
  '../../../../workflows/fixtures/scoring.workflow.json',
);
const scoringWorkflowConfig = JSON.parse(readFileSync(scoringWorkflowPath, 'utf8'));

const COLLECT_PROFILE_STEP = 'collect_profile';
const REQUEST_CODE_STEP = 'request_code';
const VERIFY_CODE_STEP = 'verify_code';
const CAPTURE_IDENTITY_STEP = 'capture_identity';
const CAPTURE_IDENTITY_BACK_STEP = 'capture_identity_back';
const CAPTURE_SELFIE_STEP = 'capture_selfie';
const SUBMIT_KYC_STEP = 'submit_kyc';
const SEND_WELCOME_STEP = 'send_welcome';
const MANUAL_REVIEW_STEP = 'manual_review';
const APPROVED_STEP = 'approved';
const REJECTED_STEP = 'rejected';
const RISK_SCORE = 'risk';
const TRUST_SCORE = 'trust';

const NO_SCORING_STEPS = [
  REQUEST_CODE_STEP,
  CAPTURE_IDENTITY_STEP,
  CAPTURE_IDENTITY_BACK_STEP,
  SEND_WELCOME_STEP,
  MANUAL_REVIEW_STEP,
  APPROVED_STEP,
  REJECTED_STEP,
];

describe('scoring.workflow.json', () => {
  const definition = validateAndNormalizeWorkflow(scoringWorkflowConfig);
  const scoring = new Scoring(definition.scores);

  it('loads and normalizes through the existing registry with no error', () => {
    expect(definition.id).toBe('scoring');
    expect(definition.version).toBe(1);
    expect(Object.keys(definition.stepsByName)).toHaveLength(11);
    expect(definition.stepsByName[COLLECT_PROFILE_STEP]).toBeDefined();
    expect(definition.stepsByName[REQUEST_CODE_STEP]).toBeDefined();
    expect(definition.stepsByName[VERIFY_CODE_STEP]).toBeDefined();
    expect(definition.stepsByName[CAPTURE_IDENTITY_STEP]).toBeDefined();
    expect(definition.stepsByName[CAPTURE_IDENTITY_BACK_STEP]).toBeDefined();
    expect(definition.stepsByName[CAPTURE_SELFIE_STEP]).toBeDefined();
    expect(definition.stepsByName[SUBMIT_KYC_STEP]).toBeDefined();
    expect(definition.stepsByName[SEND_WELCOME_STEP]).toBeDefined();
    expect(definition.stepsByName[MANUAL_REVIEW_STEP]).toBeDefined();
    expect(definition.stepsByName[APPROVED_STEP]).toBeDefined();
    expect(definition.stepsByName[REJECTED_STEP]).toBeDefined();
  });

  it('normalizes both root scores with their declared bounds', () => {
    expect(definition.scores).toEqual({
      [RISK_SCORE]: { name: RISK_SCORE, min: 0, max: 100 },
      [TRUST_SCORE]: { name: TRUST_SCORE, min: 0, max: 50 },
    });
  });

  it("normalizes collect_profile's scoring rules with their when clauses and add amounts intact", () => {
    const rules = definition.stepsByName[COLLECT_PROFILE_STEP].scoring;

    expect(rules).toHaveLength(6);
    expect(rules[0]).toEqual({
      score: RISK_SCORE,
      add: 40,
      when: { field: 'country', in: ['RU', 'IR'] },
    });
    expect(rules[1]).toEqual({
      score: RISK_SCORE,
      add: -10,
      when: { field: 'country', equals: 'PL' },
    });
    expect(rules[2]).toEqual({
      score: RISK_SCORE,
      add: 20,
      when: { field: 'highRiskChannel', equals: true },
    });
    expect(rules[3]).toEqual({
      score: RISK_SCORE,
      add: 25,
      when: { field: 'pepSelfDeclared', equals: true },
    });
    // The unconditional rule always contributes, so it normalizes with no `when` at all.
    expect(rules[4]).toEqual({ score: RISK_SCORE, add: 5 });
    expect(rules[4]).not.toHaveProperty('when');
    expect(rules[5]).toEqual({
      score: TRUST_SCORE,
      add: 10,
      when: { field: 'country', equals: 'PL' },
    });
  });

  it("normalizes verify_code's unconditional trust rule and its plain success/rejected transitions", () => {
    const rules = definition.stepsByName[VERIFY_CODE_STEP].scoring;

    expect(rules).toEqual([{ score: TRUST_SCORE, add: 15 }]);
    expect(rules[0]).not.toHaveProperty('when');

    const transitions = definition.stepsByName[VERIFY_CODE_STEP].transitions;
    const successArm = transitions.find((transition) => transition.status === 'success');
    const rejectedArm = transitions.find((transition) => transition.status === 'rejected');

    expect(successArm?.when).toBeUndefined();
    expect(successArm?.target).toBe(CAPTURE_IDENTITY_STEP);
    expect(rejectedArm?.target).toBe(REJECTED_STEP);
  });

  it("normalizes submit_kyc's three kycOutcome-gated scoring rules", () => {
    const rules = definition.stepsByName[SUBMIT_KYC_STEP].scoring;

    expect(rules).toEqual([
      { score: TRUST_SCORE, add: 25, when: { field: 'kycOutcome', equals: 'verified' } },
      { score: RISK_SCORE, add: 40, when: { field: 'kycOutcome', equals: 'human_review' } },
      { score: RISK_SCORE, add: 15, when: { field: 'kycOutcome', equals: 'retry' } },
    ]);
  });

  it('carries no scoring rules on steps that declare none', () => {
    for (const step of NO_SCORING_STEPS) {
      expect(definition.stepsByName[step].scoring).toEqual([]);
    }
  });

  it("normalizes collect_profile's score-gated transition arm and its unconditional fallback", () => {
    const transitions = definition.stepsByName[COLLECT_PROFILE_STEP].transitions;
    const highRiskArm = transitions.find(
      (transition) => transition.target === MANUAL_REVIEW_STEP && transition.when !== undefined,
    );
    const fallbackArm = transitions.find(
      (transition) => transition.target === REQUEST_CODE_STEP && transition.when === undefined,
    );

    expect(highRiskArm?.when).toEqual({ score: RISK_SCORE, gte: 60 });
    expect(fallbackArm).toBeDefined();
  });

  it("normalizes submit_kyc's compound manual_review arm ahead of its plain verified/retry arms", () => {
    const transitions = definition.stepsByName[SUBMIT_KYC_STEP].transitions;

    // The compound arm must precede the plain `verified` arm: transition order is precedence, and
    // this ordering is what lets an accumulated-risk case still land on manual_review despite a
    // clean KYC outcome (covered below).
    const compoundIndex = transitions.findIndex(
      (transition) =>
        transition.target === MANUAL_REVIEW_STEP &&
        transition.when !== undefined &&
        'all' in transition.when,
    );
    const verifiedIndex = transitions.findIndex(
      (transition) => transition.target === SEND_WELCOME_STEP,
    );
    const humanReviewIndex = transitions.findIndex(
      (transition) =>
        transition.target === MANUAL_REVIEW_STEP &&
        transition.when !== undefined &&
        'field' in transition.when,
    );
    const identityRetryIndex = transitions.findIndex(
      (transition) => transition.target === CAPTURE_IDENTITY_STEP,
    );
    const selfieRetryIndex = transitions.findIndex(
      (transition) => transition.target === CAPTURE_SELFIE_STEP,
    );
    const fallbackIndex = transitions.findIndex(
      (transition) => transition.target === REJECTED_STEP && transition.when === undefined,
    );

    expect(compoundIndex).toBeGreaterThanOrEqual(0);
    expect(compoundIndex).toBeLessThan(verifiedIndex);
    expect(transitions[compoundIndex].when).toEqual({
      all: [
        { field: 'kycOutcome', equals: 'verified' },
        { score: RISK_SCORE, gte: 60 },
      ],
    });
    expect(humanReviewIndex).toBeGreaterThanOrEqual(0);
    expect(identityRetryIndex).toBeGreaterThanOrEqual(0);
    expect(selfieRetryIndex).toBeGreaterThanOrEqual(0);
    expect(fallbackIndex).toBe(transitions.length - 1);
  });

  it("makes the fixture's own arithmetic decide collect_profile's branch, not merely parse", () => {
    // country: RU + highRiskChannel: true + pepSelfDeclared: false ->
    // 40 (RU) + 20 (highRiskChannel) + 5 (unconditional) = 65 risk, 0 trust. The transition
    // threshold is declared at `gte: 60` specifically so this sum crosses it.
    const highRisk = scoring.applyRules(
      scoring.initialize(),
      definition.stepsByName[COLLECT_PROFILE_STEP].scoring,
      {
        country: 'RU',
        highRiskChannel: true,
        pepSelfDeclared: false,
      },
    );
    expect(highRisk).toEqual({ [RISK_SCORE]: 65, [TRUST_SCORE]: 0 });

    // country: PL + highRiskChannel: false + pepSelfDeclared: false ->
    // -10 (PL) + 5 (unconditional) = -5, clamped to the risk score's declared `min` of 0;
    // 10 (PL) trust.
    const lowRisk = scoring.applyRules(
      scoring.initialize(),
      definition.stepsByName[COLLECT_PROFILE_STEP].scoring,
      {
        country: 'PL',
        highRiskChannel: false,
        pepSelfDeclared: false,
      },
    );
    expect(lowRisk).toEqual({ [RISK_SCORE]: 0, [TRUST_SCORE]: 10 });

    const transitions = definition.stepsByName[COLLECT_PROFILE_STEP].transitions;
    const highRiskArm = transitions.find(
      (transition) => transition.target === MANUAL_REVIEW_STEP && transition.when !== undefined,
    );
    const fallbackArm = transitions.find((transition) => transition.when === undefined);

    // The high-risk case satisfies the `gte: 60` arm.
    expect(evaluateCondition(highRiskArm!.when, {}, highRisk)).toBe(true);

    // The low-risk case does not, so the onboarding falls through to the unconditional fallback
    // arm into `request_code` instead.
    expect(evaluateCondition(highRiskArm!.when, {}, lowRisk)).toBe(false);
    expect(fallbackArm).toBeDefined();
    expect(fallbackArm?.when).toBeUndefined();
    expect(fallbackArm?.target).toBe(REQUEST_CODE_STEP);
  });

  it('accumulates risk across a retry loop so a later verified pass still lands on manual_review', () => {
    // country: RU, no highRiskChannel/pepSelfDeclared -> 40 (RU) + 5 (unconditional) = 45 risk.
    let scores = scoring.applyRules(
      scoring.initialize(),
      definition.stepsByName[COLLECT_PROFILE_STEP].scoring,
      {
        country: 'RU',
        highRiskChannel: false,
        pepSelfDeclared: false,
      },
    );
    expect(scores).toEqual({ [RISK_SCORE]: 45, [TRUST_SCORE]: 0 });

    // First submit_kyc pass: kycOutcome retry -> risk +15 = 60.
    scores = scoring.applyRules(scores, definition.stepsByName[SUBMIT_KYC_STEP].scoring, {
      kycOutcome: 'retry',
    });
    expect(scores).toEqual({ [RISK_SCORE]: 60, [TRUST_SCORE]: 0 });

    const retryTransitions = definition.stepsByName[SUBMIT_KYC_STEP].transitions;
    const identityRetryArm = retryTransitions.find(
      (transition) => transition.target === CAPTURE_IDENTITY_STEP,
    );
    expect(
      evaluateCondition(
        identityRetryArm!.when,
        { kycOutcome: 'retry', kycRetryStep: 'IDENTITY' },
        scores,
      ),
    ).toBe(true);

    // Second submit_kyc pass, after looping back through capture_identity /
    // capture_identity_back / capture_selfie: kycOutcome verified -> trust +25 = 25. The `retry`
    // pass's risk is never undone, so risk stays at 60.
    scores = scoring.applyRules(scores, definition.stepsByName[SUBMIT_KYC_STEP].scoring, {
      kycOutcome: 'verified',
    });
    expect(scores).toEqual({ [RISK_SCORE]: 60, [TRUST_SCORE]: 25 });

    // The compound arm is declared ahead of the plain `verified` arm, so the accumulated risk
    // routes to manual_review even though this pass's own kycOutcome is verified.
    const compoundArm = retryTransitions.find(
      (transition) => transition.target === MANUAL_REVIEW_STEP && transition.when !== undefined,
    );
    const firstMatchingArm = retryTransitions.find((transition) =>
      evaluateCondition(transition.when, { kycOutcome: 'verified' }, scores),
    );

    expect(evaluateCondition(compoundArm!.when, { kycOutcome: 'verified' }, scores)).toBe(true);
    expect(firstMatchingArm).toBe(compoundArm);
    expect(firstMatchingArm?.target).toBe(MANUAL_REVIEW_STEP);
  });
});
