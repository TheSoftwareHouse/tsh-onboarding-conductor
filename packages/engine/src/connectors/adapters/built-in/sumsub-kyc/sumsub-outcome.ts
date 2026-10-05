import type { KycVerdict } from '../kyc/kyc-provider.port';
import type { SumsubApplicantInfo } from './sumsub-client';
import type { SumsubDocSetKey, SumsubReviewRejectType } from './sumsub-contract';

/** One AML/screening case entry, shape unverified against this tenant — read defensively. */
export type SumsubScreeningHit = Readonly<Record<string, unknown>>;

/**
 * Every fact the read-back gathers for a completed review. `screeningHits` is `undefined` for
 * Sumsub's `204` ("no case"), kept distinct from an empty array ("case exists, zero hits"): a
 * `204` is *no evidence*, not *clear*. `attemptCnt` and `failedDocSet` are only ever populated on
 * a RED verdict.
 */
export type SumsubOutcomeInput = Readonly<{
  screeningHits: readonly SumsubScreeningHit[] | undefined;
  reviewAnswer: string | undefined;
  reviewRejectType: SumsubReviewRejectType | undefined;
  attemptCnt: number | undefined;
  failedDocSet: SumsubDocSetKey | undefined;
  moderationComment: string | undefined;
  buttonIds: readonly string[] | undefined;
  verifiedInfo: SumsubApplicantInfo | undefined;
}>;

/**
 * No row of the table matched. Never defaulted to an outcome — thrown so the callback answers 5xx
 * and Sumsub redelivers.
 *
 * The message carries only non-content facts — `reviewAnswer`, `reviewRejectType`, `attemptCnt`,
 * `failedDocSet` and `screeningHits.length` — never `input` itself. `screeningHits` holds the raw,
 * unfiltered AML entries as Sumsub returned them (a matched person's name, date of birth and
 * free-text comment), and this is reachable with hits populated: a hit dispositioned
 * `false_positive` passes the screening row, then a `reviewAnswer` that is neither GREEN nor RED
 * falls through. Logging the raw entries would put third-party PII into the application log via
 * Nest's default uncaught-error handling.
 */
export class SumsubOutcomeUnrecognisedStateError extends Error {
  constructor(input: SumsubOutcomeInput) {
    super(
      `sumsub_kyc callback matched no outcome row: reviewAnswer=${input.reviewAnswer ?? 'undefined'} ` +
        `reviewRejectType=${input.reviewRejectType ?? 'undefined'} ` +
        `attemptCnt=${input.attemptCnt ?? 'undefined'} failedDocSet=${input.failedDocSet ?? 'undefined'} ` +
        `screeningHitsCount=${input.screeningHits?.length ?? 0}`,
    );
    this.name = 'SumsubOutcomeUnrecognisedStateError';
  }
}

export const SUMSUB_REASON_ON_HOLD_OR_AWAITING_SERVICE = 'on_hold_or_awaiting_service';
export const SUMSUB_REASON_SCREENING_UNRESOLVED = 'screening_unresolved';

const REVIEW_ANSWER_RED = 'RED';
const REVIEW_ANSWER_GREEN = 'GREEN';
const SCREENING_DISPOSITION_FALSE_POSITIVE = 'false_positive';

/**
 * A screening case is resolved only when it exists and every hit is dispositioned
 * `false_positive`. `undefined` (Sumsub's `204`) is deliberately not resolved — "no evidence"
 * is not "clear". `matchStatus` and any other hit field are never interpreted.
 */
function isScreeningResolved(hits: readonly SumsubScreeningHit[] | undefined): boolean {
  if (hits === undefined) {
    return false;
  }

  return hits.every((hit) => hit.disposition === SCREENING_DISPOSITION_FALSE_POSITIVE);
}

export function findFirstUnresolvedHit(
  hits: readonly SumsubScreeningHit[] | undefined,
): SumsubScreeningHit | undefined {
  return hits?.find((hit) => hit.disposition !== SCREENING_DISPOSITION_FALSE_POSITIVE);
}

const readInfoString = (info: SumsubApplicantInfo | undefined, key: string): string | undefined => {
  const value = info?.[key];

  return typeof value === 'string' ? value : undefined;
};

/**
 * Maps a completed Sumsub review onto the kernel's verdict vocabulary, stopping at the first
 * match. The order is the point: an unresolved screening hit overrides a GREEN result rather than
 * being overridden by it, and a RED verdict is decided before a verified identity is ever read —
 * a RED verdict typically carries no verified `info` block at all. The identity guard, the
 * attempt cap and the outcome contract belong to the kernel; a state this table cannot explain
 * throws.
 */
export function mapSumsubOutcomeToVerdict(input: SumsubOutcomeInput): KycVerdict {
  if (!isScreeningResolved(input.screeningHits)) {
    return {
      kind: 'needs_review',
      reason: SUMSUB_REASON_SCREENING_UNRESOLVED,
      detail: { hitCount: input.screeningHits?.length ?? 0 },
    };
  }

  if (input.reviewAnswer === REVIEW_ANSWER_RED) {
    if (input.reviewRejectType === 'FINAL') {
      return {
        kind: 'declined',
        reasonCodes: input.buttonIds,
        customerMessage: input.moderationComment,
      };
    }

    if (
      input.reviewRejectType === 'RETRY' &&
      input.failedDocSet &&
      input.attemptCnt !== undefined
    ) {
      return {
        kind: 'resubmission',
        target: input.failedDocSet,
        attemptCount: input.attemptCnt,
        reasonCodes: input.buttonIds,
        customerMessage: input.moderationComment,
      };
    }

    // A RED verdict this table cannot explain (unknown rejectType, or a RETRY with no resolvable
    // failed docSet / attemptCnt).
    throw new SumsubOutcomeUnrecognisedStateError(input);
  }

  if (input.reviewAnswer === REVIEW_ANSWER_GREEN) {
    return {
      kind: 'approved',
      verifiedIdentity: {
        lastName: readInfoString(input.verifiedInfo, 'lastName'),
        dateOfBirth: readInfoString(input.verifiedInfo, 'dob'),
      },
    };
  }

  throw new SumsubOutcomeUnrecognisedStateError(input);
}
