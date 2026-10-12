import {
  mapSumsubOutcomeToVerdict,
  SumsubOutcomeUnrecognisedStateError,
  type SumsubOutcomeInput,
} from './sumsub-outcome';

const baseInput = (): SumsubOutcomeInput => ({
  screeningHits: [],
  reviewAnswer: 'GREEN',
  reviewRejectType: undefined,
  attemptCnt: undefined,
  failedDocSet: undefined,
  moderationComment: undefined,
  buttonIds: undefined,
  verifiedInfo: { lastName: 'Kowalska', dob: '1990-05-14' },
});

describe('mapSumsubOutcomeToVerdict', () => {
  it('an unresolved screening hit needs review, outranking a GREEN verdict', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'exact', disposition: 'pending' }],
    });

    expect(verdict).toEqual({
      kind: 'needs_review',
      reason: 'screening_unresolved',
      detail: { hitCount: 1 },
    });
  });

  it('a 204 (undefined) AML case never produces an approval', () => {
    const verdict = mapSumsubOutcomeToVerdict({ ...baseInput(), screeningHits: undefined });

    expect(verdict).toEqual({
      kind: 'needs_review',
      reason: 'screening_unresolved',
      detail: { hitCount: 0 },
    });
  });

  it('a hit dispositioned false_positive does not block an approval', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'exact', disposition: 'false_positive' }],
    });

    expect(verdict.kind).toBe('approved');
  });

  it('a hit with an unrecognised matchStatus is still treated as unresolved', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      screeningHits: [{ matchStatus: 'never-seen-before', disposition: 'unknown' }],
    });

    expect(verdict).toMatchObject({ kind: 'needs_review', reason: 'screening_unresolved' });
  });

  it('GREEN is approved with the verified last name and date of birth', () => {
    expect(mapSumsubOutcomeToVerdict(baseInput())).toEqual({
      kind: 'approved',
      verifiedIdentity: { lastName: 'Kowalska', dateOfBirth: '1990-05-14' },
    });
  });

  it('GREEN with no verified identity block carries no identity fields', () => {
    expect(mapSumsubOutcomeToVerdict({ ...baseInput(), verifiedInfo: {} })).toEqual({
      kind: 'approved',
      verifiedIdentity: { lastName: undefined, dateOfBirth: undefined },
    });
  });

  it('RED with reviewRejectType FINAL is declined, carrying buttonIds and the moderation comment', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'FINAL',
      buttonIds: ['FORGERY'],
      moderationComment: 'Document looks altered',
    });

    expect(verdict).toEqual({
      kind: 'declined',
      reasonCodes: ['FORGERY'],
      customerMessage: 'Document looks altered',
    });
  });

  it('RED with reviewRejectType RETRY is a resubmission of the failed docSet with Sumsub’s own count', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'RETRY',
      attemptCnt: 2,
      failedDocSet: 'SELFIE',
      buttonIds: ['BAD_SELFIE'],
    });

    expect(verdict).toEqual({
      kind: 'resubmission',
      target: 'SELFIE',
      attemptCount: 2,
      reasonCodes: ['BAD_SELFIE'],
      customerMessage: undefined,
    });
  });

  it('a RED verdict is decided without reading a verified identity', () => {
    const verdict = mapSumsubOutcomeToVerdict({
      ...baseInput(),
      reviewAnswer: 'RED',
      reviewRejectType: 'FINAL',
      verifiedInfo: undefined,
    });

    expect(verdict.kind).toBe('declined');
  });

  it('an unrecognised review answer throws rather than defaulting an outcome', () => {
    expect(() =>
      mapSumsubOutcomeToVerdict({ ...baseInput(), reviewAnswer: 'UNKNOWN_ANSWER' }),
    ).toThrow(SumsubOutcomeUnrecognisedStateError);
  });

  it('a RETRY reject type with no resolvable failed docSet throws', () => {
    expect(() =>
      mapSumsubOutcomeToVerdict({
        ...baseInput(),
        reviewAnswer: 'RED',
        reviewRejectType: 'RETRY',
        attemptCnt: undefined,
        failedDocSet: undefined,
      }),
    ).toThrow(SumsubOutcomeUnrecognisedStateError);
  });

  it('the thrown message carries no screening-hit content — only non-content facts', () => {
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
      mapSumsubOutcomeToVerdict(input);
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
});
