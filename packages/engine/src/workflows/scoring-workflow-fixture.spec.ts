import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { validateAndNormalizeWorkflow } from '@tsh/ddl-schema';
import { Workflow } from './domain/workflow';

const configPath = resolve(__dirname, '../../../../workflows/fixtures/scoring.workflow.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));

/**
 * The checked-in scoring fixture, driven the way an onboarding drives it. It is the document the
 * e2e suite and the verification runbook both exercise, so the journeys are pinned here first.
 */
describe('scoring workflow fixture', () => {
  const workflow = () => new Workflow(validateAndNormalizeWorkflow(config));

  const submit = (
    currentStep: string,
    submittedData: Record<string, unknown>,
    scoreByStep: Record<string, number>,
    onboardingContext: Record<string, unknown> = {},
  ) =>
    workflow().evaluate({
      currentStep,
      submittedData,
      onboardingContext,
      onboardingId: 'onboarding-1',
      scoreByStep,
    });

  it('normalizes with the declared weights, points and skip', () => {
    const definition = validateAndNormalizeWorkflow(config);

    expect(definition.stepsByName.collect_profile.scoring.weight).toBe(3);
    expect(definition.stepsByName.verify_identity.scoring.weight).toBe(2);
    expect(definition.stepsByName.enhanced_due_diligence.skip).toEqual({
      when: { field: '$score', gte: 40 },
      target: 'approved',
    });
  });

  it('clears a trusted applicant without ever entering enhanced due diligence', async () => {
    const profile = await submit('collect_profile', { country: 'PL' }, {});
    expect(profile.getNextState()!.score).toBe(30);
    expect(profile.getNextState()!.currentStep).toBe('verify_identity');

    const verified = await submit(
      'verify_identity',
      { identityCode: 'VALID' },
      profile.getNextState()!.scoreByStep as Record<string, number>,
      profile.getNextState()!.context,
    );

    // 30 + (weight 2 x points 5) = 40, exactly the skip threshold.
    expect(verified.getNextState()!.score).toBe(40);
    expect(verified.getSkippedSteps()).toEqual(['enhanced_due_diligence']);
    expect(verified.getNextState()!.status).toBe('approved');
    expect(verified.getNextState()!.currentStep).toBeNull();
  });

  it('routes a lower-scoring applicant into enhanced due diligence', async () => {
    const profile = await submit('collect_profile', { country: 'US' }, {});
    // The fallback arm: weight 3 x points 2.
    expect(profile.getNextState()!.score).toBe(6);

    const verified = await submit(
      'verify_identity',
      { identityCode: 'VALID' },
      profile.getNextState()!.scoreByStep as Record<string, number>,
      profile.getNextState()!.context,
    );

    expect(verified.getNextState()!.score).toBe(16);
    expect(verified.getSkippedSteps()).toEqual([]);
    expect(verified.getNextState()!.currentStep).toBe('enhanced_due_diligence');
  });

  it('scores a retried step once, at its most recent outcome', async () => {
    const profile = await submit('collect_profile', { country: 'PL' }, {});
    let scoreByStep = profile.getNextState()!.scoreByStep as Record<string, number>;

    // First attempt fails and routes into the resend loop.
    const failed = await submit('verify_identity', { identityCode: 'WRONG' }, scoreByStep);
    expect(failed.getNextState()!.currentStep).toBe('resend_identity_code');
    expect(failed.getNextState()!.score).toBe(10);
    scoreByStep = failed.getNextState()!.scoreByStep as Record<string, number>;

    // Second attempt fails the same way; the step still contributes only once.
    const resent = await submit('resend_identity_code', { resendRequested: true }, scoreByStep);
    scoreByStep = resent.getNextState()!.scoreByStep as Record<string, number>;
    const failedAgain = await submit('verify_identity', { identityCode: 'WRONG' }, scoreByStep);
    expect(failedAgain.getNextState()!.score).toBe(10);
    expect(failedAgain.getNextState()!.scoreByStep).toEqual({
      collect_profile: 30,
      verify_identity: -20,
      resend_identity_code: 0,
    });
    scoreByStep = failedAgain.getNextState()!.scoreByStep as Record<string, number>;

    // Third attempt succeeds: the -20 is replaced, not added to.
    const resentAgain = await submit(
      'resend_identity_code',
      { resendRequested: true },
      scoreByStep,
    );
    const passed = await submit(
      'verify_identity',
      { identityCode: 'VALID' },
      resentAgain.getNextState()!.scoreByStep as Record<string, number>,
    );

    expect(passed.getNextState()!.scoreByStep).toEqual({
      collect_profile: 30,
      verify_identity: 10,
      resend_identity_code: 0,
    });
    // Three attempts, but the step contributes its passing outcome only.
    expect(passed.getNextState()!.score).toBe(40);
    expect(passed.getSkippedSteps()).toEqual(['enhanced_due_diligence']);
  });
});
