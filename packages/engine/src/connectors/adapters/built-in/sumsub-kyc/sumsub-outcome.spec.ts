import {
  evaluateSumsubOutcome,
  SumsubOutcomeUnrecognisedStateError,
  type SumsubOutcomeInput,
} from './sumsub-outcome';

const baseInput = (): SumsubOutcomeInput => ({
  isOnHoldOrAwaitingService: false,
  screeningHits: [],
  identityComparison: 'match',
  reviewAnswer: 'GREEN',
  reviewRejectType: undefined,
  attemptCnt: undefined,
  maxAttemptsPerDocSet: 3,
  failedDocSet: undefined,
});

describe('evaluateSumsubOutcome', () => {
  it('row 1: an on-hold or awaiting-service event yields human_review', () => {
    expect(evaluateSumsubOutcome({ ...baseInput(), isOnHoldOrAwaitingService: true })).toEqual({
      kycOutcome: 'human_review',
      reason: 'on_hold_or_awaiting_service',
    });
  });

  it('row 2: an unresolved screening hit yields human_review, outranking a GREEN verdict', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'exact', disposition: 'pending' }],
    });

    expect(result.kycOutcome).toBe('human_review');
    expect(result).toMatchObject({ reason: 'screening_unresolved', hitCount: 1 });
  });

  it('row 2: a 204 (undefined) AML case never produces verified', () => {
    const result = evaluateSumsubOutcome({ ...baseInput(), screeningHits: undefined });

    expect(result.kycOutcome).not.toBe('verified');
    expect(result).toMatchObject({ reason: 'screening_unresolved', hitCount: 0 });
  });

  it('row 2: a hit dispositioned false_positive does not block verified', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'exact', disposition: 'false_positive' }],
    });

    expect(result).toEqual({ kycOutcome: 'verified' });
  });

  it('row 2: a hit with an unrecognised matchStatus is still treated as unresolved', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'never-seen-before', disposition: 'unknown' }],
    });

    expect(result.kycOutcome).toBe('human_review');
    expect(result).toMatchObject({ reason: 'screening_unresolved' });
  });

  it('row 3: a declared/verified mismatch yields human_review, outranking a GREEN verdict', () => {
    const result = evaluateSumsubOutcome({ ...baseInput(), identityComparison: 'mismatch' });

    expect(result).toEqual({
      kycOutcome: 'human_review',
      reason: 'identity_guard',
      mismatchKind: 'mismatch',
    });
  });

  it('row 3: no verified identity data at all yields human_review, never verified or a throw', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      identityComparison: 'no-verified-data',
    });

    expect(result).toEqual({
      kycOutcome: 'human_review',
      reason: 'identity_guard',
      mismatchKind: 'no-verified-data',
    });
  });

  it('row 4: RED with reviewRejectType FINAL yields refused', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'FINAL',
    });

    expect(result).toEqual({ kycOutcome: 'refused', reason: 'final_rejection' });
  });

  it('row 5: attemptCnt at the cap yields human_review, not retry', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'RETRY',
      attemptCnt: 3,
      maxAttemptsPerDocSet: 3,
      failedDocSet: 'IDENTITY',
    });

    expect(result).toEqual({
      kycOutcome: 'human_review',
      reason: 'attempts_exhausted',
      docSet: 'IDENTITY',
      attemptCnt: 3,
      maxAttemptsPerDocSet: 3,
    });
  });

  it('row 6: RED with reviewRejectType RETRY, one attempt below the cap, yields retry', () => {
    const result = evaluateSumsubOutcome({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'RETRY',
      attemptCnt: 2,
      maxAttemptsPerDocSet: 3,
      failedDocSet: 'SELFIE',
    });

    expect(result).toEqual({
      kycOutcome: 'retry',
      docSet: 'SELFIE',
      attemptCnt: 2,
      maxAttemptsPerDocSet: 3,
    });
  });

  it('row 7: GREEN with screening resolved and identity matching yields verified', () => {
    const result = evaluateSumsubOutcome(baseInput());

    expect(result).toEqual({ kycOutcome: 'verified' });
  });

  it('row 8: an unrecognised state throws rather than defaulting an outcome', () => {
    expect(() => evaluateSumsubOutcome({ ...baseInput(), reviewAnswer: 'UNKNOWN_ANSWER' })).toThrow(
      SumsubOutcomeUnrecognisedStateError,
    );
  });

  it('row 8: a RETRY reject type with no resolvable failed docSet throws', () => {
    expect(() =>
      evaluateSumsubOutcome({
        ...baseInput(),
        reviewAnswer: 'RED',
        reviewRejectType: 'RETRY',
        attemptCnt: undefined,
        failedDocSet: undefined,
      }),
    ).toThrow(SumsubOutcomeUnrecognisedStateError);
  });

  it('row 8: the thrown message carries no screening-hit content — only non-content facts', () => {
    const input: SumsubOutcomeInput = {
      ...baseInput(),
      reviewAnswer: 'UNKNOWN_ANSWER',
      screeningHits: [
        {
          disposition: 'false_positive',
          matchStatus: 'exact',
          name: 'Someone Sanctioned',
          dob: '1975-05-05',
          comment: 'free text about the match',
        },
      ],
    };

    let caught: unknown;
    try {
      evaluateSumsubOutcome(input);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(SumsubOutcomeUnrecognisedStateError);
    const message = (caught as Error).message;
    expect(message).not.toContain('Someone Sanctioned');
    expect(message).not.toContain('1975-05-05');
    expect(message).not.toContain('free text about the match');
    expect(message).not.toContain('exact');
    expect(message).toContain('reviewAnswer=UNKNOWN_ANSWER');
    expect(message).toContain('screeningHitsCount=1');
  });

  describe('row 3 does not preempt a RED verdict', () => {
    it('a RED/FINAL verdict with no verified identity block still yields refused', () => {
      const result = evaluateSumsubOutcome({
        ...baseInput(),
        reviewAnswer: 'RED',
        reviewRejectType: 'FINAL',
        identityComparison: 'no-verified-data',
      });

      expect(result).toEqual({ kycOutcome: 'refused', reason: 'final_rejection' });
    });

    it('a RED/RETRY verdict with no verified identity block still yields retry', () => {
      const result = evaluateSumsubOutcome({
        ...baseInput(),
        reviewAnswer: 'RED',
        reviewRejectType: 'RETRY',
        identityComparison: 'no-verified-data',
        attemptCnt: 1,
        maxAttemptsPerDocSet: 3,
        failedDocSet: 'IDENTITY',
      });

      expect(result).toEqual({
        kycOutcome: 'retry',
        docSet: 'IDENTITY',
        attemptCnt: 1,
        maxAttemptsPerDocSet: 3,
      });
    });

    it('a GREEN verdict with no verified identity block still yields human_review, not verified', () => {
      const result = evaluateSumsubOutcome({
        ...baseInput(),
        reviewAnswer: 'GREEN',
        identityComparison: 'no-verified-data',
      });

      expect(result).toEqual({
        kycOutcome: 'human_review',
        reason: 'identity_guard',
        mismatchKind: 'no-verified-data',
      });
    });
  });
});
