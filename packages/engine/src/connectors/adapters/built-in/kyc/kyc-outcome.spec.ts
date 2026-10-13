import { buildKycSubmittedData, evaluateKycOutcome, type KycOutcomeInput } from './kyc-outcome';
import type { KycAppliedEvaluation } from './kyc-outcome';
import type { KycVerdict } from './kyc-provider.port';

const MATCH = { result: 'match', divergedFields: [] } as const;

const baseInput = (overrides: Partial<KycOutcomeInput> = {}): KycOutcomeInput => ({
  identityComparison: MATCH,
  previousAttemptCount: 0,
  maxAttemptsPerDocSet: 3,
  providerCountsAttempts: false,
  ...overrides,
});

const APPROVED: KycVerdict = {
  kind: 'approved',
  verifiedIdentity: { lastName: 'Kowalska', dateOfBirth: '1990-05-14' },
};

const decide = (verdict: KycVerdict, input: KycOutcomeInput): KycAppliedEvaluation => {
  const evaluation = evaluateKycOutcome(verdict, input);

  if (evaluation.action !== 'apply') {
    throw new Error('expected a decision to apply');
  }

  return evaluation.decision;
};

describe('evaluateKycOutcome', () => {
  it('parks on a pending verdict', () => {
    expect(evaluateKycOutcome({ kind: 'pending' }, baseInput())).toEqual({ action: 'park' });
  });

  it('turns needs_review into human_review carrying the provider reason and counts', () => {
    expect(
      decide(
        { kind: 'needs_review', reason: 'screening_unresolved', detail: { hitCount: 2 } },
        baseInput(),
      ),
    ).toEqual({
      kycOutcome: 'human_review',
      reason: 'needs_review',
      providerReason: 'screening_unresolved',
      detail: { hitCount: 2 },
    });
  });

  it('verifies an approval whose declared identity matches', () => {
    expect(decide(APPROVED, baseInput())).toEqual({ kycOutcome: 'verified' });
  });

  it.each([
    ['mismatch', ['lastName']],
    ['no-verified-data', []],
  ] as const)('an approval with a %s identity goes to human_review', (result, divergedFields) => {
    expect(decide(APPROVED, baseInput({ identityComparison: { result, divergedFields } }))).toEqual(
      {
        kycOutcome: 'human_review',
        reason: 'identity_guard',
        mismatchKind: result,
        divergedFields,
      },
    );
  });

  it('does not apply the identity guard to a decline', () => {
    expect(
      decide(
        { kind: 'declined', reasonCodes: ['FORGERY'], customerMessage: 'No' },
        baseInput({ identityComparison: { result: 'no-verified-data', divergedFields: [] } }),
      ),
    ).toEqual({ kycOutcome: 'refused', reasonCodes: ['FORGERY'], customerMessage: 'No' });
  });

  describe('a resubmission', () => {
    const resubmission = (extra: Partial<KycVerdict> = {}): KycVerdict =>
      ({ kind: 'resubmission', target: 'IDENTITY', ...extra }) as KycVerdict;

    it('uses the provider’s own attempt count when it reports one', () => {
      expect(
        decide(
          resubmission({ attemptCount: 2 } as never),
          baseInput({ providerCountsAttempts: true }),
        ),
      ).toMatchObject({
        kycOutcome: 'retry',
        target: 'IDENTITY',
        attempts: 2,
        recordedAttemptCount: undefined,
      });
    });

    it('counts previous attempts plus one when the provider reports none, and records the total', () => {
      expect(decide(resubmission(), baseInput({ previousAttemptCount: 1 }))).toMatchObject({
        kycOutcome: 'retry',
        attempts: 2,
        recordedAttemptCount: 2,
      });
    });

    it('hands over to human_review once the attempts reach the cap, before retrying', () => {
      expect(decide(resubmission(), baseInput({ previousAttemptCount: 2 }))).toEqual({
        kycOutcome: 'human_review',
        reason: 'attempts_exhausted',
        target: 'IDENTITY',
        attempts: 3,
        maxAttemptsPerDocSet: 3,
      });
    });

    it('hands over to human_review when the provider says its limit is exceeded', () => {
      expect(decide(resubmission({ limitExceeded: true } as never), baseInput())).toMatchObject({
        kycOutcome: 'human_review',
        reason: 'attempts_exhausted',
      });
    });
  });
});

describe('buildKycSubmittedData', () => {
  it('carries the reason codes and customer message on refused only as the verdict supplied them', () => {
    expect(
      buildKycSubmittedData({
        kycOutcome: 'refused',
        reasonCodes: ['FORGERY'],
        customerMessage: 'Document looks altered',
      }),
    ).toEqual({
      kycOutcome: 'refused',
      kycReasonCodes: ['FORGERY'],
      kycCustomerMessage: 'Document looks altered',
    });
  });

  it('omits empty reason codes and an empty message', () => {
    expect(
      buildKycSubmittedData({ kycOutcome: 'refused', reasonCodes: [], customerMessage: '' }),
    ).toEqual({ kycOutcome: 'refused' });
  });

  it('names the retry target and writes kycAttemptCount only when one was recorded', () => {
    const retry = {
      kycOutcome: 'retry',
      target: 'SELFIE',
      attempts: 2,
      maxAttemptsPerDocSet: 3,
    } as const;

    expect(buildKycSubmittedData(retry)).toEqual({ kycOutcome: 'retry', kycRetryStep: 'SELFIE' });
    expect(buildKycSubmittedData({ ...retry, recordedAttemptCount: 2 })).toEqual({
      kycOutcome: 'retry',
      kycRetryStep: 'SELFIE',
      kycAttemptCount: 2,
    });
  });

  it('adds nothing to verified or to any human_review', () => {
    expect(buildKycSubmittedData({ kycOutcome: 'verified' })).toEqual({ kycOutcome: 'verified' });
    expect(
      buildKycSubmittedData({
        kycOutcome: 'human_review',
        reason: 'attempts_exhausted',
        target: 'IDENTITY',
        attempts: 3,
        maxAttemptsPerDocSet: 3,
      }),
    ).toEqual({ kycOutcome: 'human_review' });
  });
});
