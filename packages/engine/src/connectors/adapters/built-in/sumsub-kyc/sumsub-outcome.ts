import type { SumsubDocSetKey, SumsubReviewRejectType } from './sumsub-contract';
import type { SumsubIdentityComparisonResult } from './sumsub-applicant';

/** One AML/screening case entry, shape unverified against this tenant — read defensively. */
export type SumsubScreeningHit = Readonly<Record<string, unknown>>;

/**
 * Every fact Task 3.2's read-back gathers, already classified — the sole input to the ordered
 * eight-row table. `screeningHits` is `undefined` for Sumsub's `204` ("no case"), kept distinct
 * from an empty array ("case exists, zero hits"): a `204` is *no evidence*, not *clear*.
 * `attemptCnt` and `failedDocSet` are only ever populated on a RED verdict — rows 1-4 and 7 never
 * read them.
 */
export type SumsubOutcomeInput = Readonly<{
  isOnHoldOrAwaitingService: boolean;
  screeningHits: readonly SumsubScreeningHit[] | undefined;
  identityComparison: SumsubIdentityComparisonResult;
  reviewAnswer: string | undefined;
  reviewRejectType: SumsubReviewRejectType | undefined;
  attemptCnt: number | undefined;
  maxAttemptsPerDocSet: number;
  failedDocSet: SumsubDocSetKey | undefined;
}>;

/**
 * The row that fired, carrying exactly what its outcome and its instrumentation need. The caller
 * maps this to the closed `SumsubCallbackSubmission` and to the three required log lines — this
 * type is not returned to the engine as-is.
 */
export type SumsubOutcomeEvaluation =
  | Readonly<{ kycOutcome: 'human_review'; reason: 'on_hold_or_awaiting_service' }>
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'screening_unresolved';
      hitCount: number;
      unresolvedHit: SumsubScreeningHit | undefined;
    }>
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'identity_guard';
      mismatchKind: Exclude<SumsubIdentityComparisonResult, 'match'>;
    }>
  | Readonly<{ kycOutcome: 'refused'; reason: 'final_rejection' }>
  | Readonly<{
      kycOutcome: 'human_review';
      reason: 'attempts_exhausted';
      docSet: SumsubDocSetKey;
      attemptCnt: number;
      maxAttemptsPerDocSet: number;
    }>
  | Readonly<{
      kycOutcome: 'retry';
      docSet: SumsubDocSetKey;
      attemptCnt: number;
      maxAttemptsPerDocSet: number;
    }>
  | Readonly<{ kycOutcome: 'verified' }>;

/**
 * No row of the ordered table matched. Never defaulted to an outcome — thrown so the callback
 * answers 5xx and Sumsub redelivers, per row 8.
 *
 * The message carries only non-content facts — `reviewAnswer`, `reviewRejectType`, the
 * identity-comparison result, `attemptCnt`, `failedDocSet` and `screeningHits.length` — never
 * `input` itself. `screeningHits` holds the raw, unfiltered AML entries as Sumsub returned them
 * (a matched person's name, date of birth and free-text comment), and row 8 is reachable with
 * hits populated: a hit dispositioned `false_positive` passes row 2, then a `reviewAnswer` that
 * is neither GREEN nor RED falls through to row 8. Logging the raw entries would put third-party
 * PII into the application log via Nest's default uncaught-error handling.
 */
export class SumsubOutcomeUnrecognisedStateError extends Error {
  constructor(input: SumsubOutcomeInput) {
    super(
      `sumsub_kyc callback matched no outcome row: reviewAnswer=${input.reviewAnswer ?? 'undefined'} ` +
        `reviewRejectType=${input.reviewRejectType ?? 'undefined'} identityComparison=${input.identityComparison} ` +
        `attemptCnt=${input.attemptCnt ?? 'undefined'} failedDocSet=${input.failedDocSet ?? 'undefined'} ` +
        `screeningHitsCount=${input.screeningHits?.length ?? 0}`,
    );
    this.name = 'SumsubOutcomeUnrecognisedStateError';
  }
}

const REVIEW_ANSWER_RED = 'RED';
const REVIEW_ANSWER_GREEN = 'GREEN';
const SCREENING_DISPOSITION_FALSE_POSITIVE = 'false_positive';

/**
 * A screening case is resolved only when it exists and every hit is dispositioned
 * `false_positive`. `undefined` (Sumsub's `204`) is deliberately not resolved — "no evidence"
 * is not "clear". `matchStatus` and any other hit field are never interpreted (Open Question 1).
 */
function isScreeningResolved(hits: readonly SumsubScreeningHit[] | undefined): boolean {
  if (hits === undefined) {
    return false;
  }

  return hits.every((hit) => hit.disposition === SCREENING_DISPOSITION_FALSE_POSITIVE);
}

function findFirstUnresolvedHit(
  hits: readonly SumsubScreeningHit[] | undefined,
): SumsubScreeningHit | undefined {
  return hits?.find((hit) => hit.disposition !== SCREENING_DISPOSITION_FALSE_POSITIVE);
}

/**
 * Evaluates the ordered eight-row table, stopping at the first match. The order is the point:
 * the guards (rows 1-2) run before any row that could produce a positive verdict, so an on-hold
 * event or an unresolved screening hit each override a GREEN result rather than being overridden
 * by it. Row 3 (the declared/verified identity guard) is scoped to a **non-RED** verdict — it
 * runs after rows 4-6 have had first refusal on a RED verdict, never before. A RED verdict
 * typically carries no verified `info` block at all, and row 3's own "no verified identity data"
 * clause would otherwise fire unconditionally and make `refused` (row 4) and `retry` (row 6)
 * unreachable. Row 5 (attempt cap) sits above row 6 (RETRY) so the cap beats the retry it is
 * capping. Row 8 never defaults an outcome — it throws.
 */
export function evaluateSumsubOutcome(input: SumsubOutcomeInput): SumsubOutcomeEvaluation {
  // Row 1
  if (input.isOnHoldOrAwaitingService) {
    return { kycOutcome: 'human_review', reason: 'on_hold_or_awaiting_service' };
  }

  // Row 2 — deliberately shallow (Open Question 1).
  if (!isScreeningResolved(input.screeningHits)) {
    return {
      kycOutcome: 'human_review',
      reason: 'screening_unresolved',
      hitCount: input.screeningHits?.length ?? 0,
      unresolvedHit: findFirstUnresolvedHit(input.screeningHits),
    };
  }

  // Rows 4-6 decide a RED verdict before row 3 ever runs — row 3 is scoped to a non-RED verdict.
  if (input.reviewAnswer === REVIEW_ANSWER_RED) {
    // Row 4
    if (input.reviewRejectType === 'FINAL') {
      return { kycOutcome: 'refused', reason: 'final_rejection' };
    }

    if (
      input.reviewRejectType === 'RETRY' &&
      input.failedDocSet &&
      input.attemptCnt !== undefined
    ) {
      // Row 5 — the cap beats the retry it is capping.
      if (input.attemptCnt >= input.maxAttemptsPerDocSet) {
        return {
          kycOutcome: 'human_review',
          reason: 'attempts_exhausted',
          docSet: input.failedDocSet,
          attemptCnt: input.attemptCnt,
          maxAttemptsPerDocSet: input.maxAttemptsPerDocSet,
        };
      }

      // Row 6
      return {
        kycOutcome: 'retry',
        docSet: input.failedDocSet,
        attemptCnt: input.attemptCnt,
        maxAttemptsPerDocSet: input.maxAttemptsPerDocSet,
      };
    }

    // Row 8 — a RED verdict this table cannot explain (unknown rejectType, or a RETRY with no
    // resolvable failed docSet / attemptCnt).
    throw new SumsubOutcomeUnrecognisedStateError(input);
  }

  // Row 3 — reached only for a non-RED verdict. Catches both `mismatch` and `no-verified-data`
  // (Open Question 3); the guard's whole purpose for a GREEN verdict is preserved unchanged.
  if (input.identityComparison !== 'match') {
    return {
      kycOutcome: 'human_review',
      reason: 'identity_guard',
      mismatchKind: input.identityComparison,
    };
  }

  // Row 7 — GREEN, and rows 2-3 already confirmed screening resolved and identity matching.
  if (input.reviewAnswer === REVIEW_ANSWER_GREEN) {
    return { kycOutcome: 'verified' };
  }

  // Row 8
  throw new SumsubOutcomeUnrecognisedStateError(input);
}
