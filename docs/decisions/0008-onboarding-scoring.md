# 0008. Onboarding scoring is per-step, declared on transition arms, and admin-only

- **Status:** Accepted
- **Date:** 2026-09-03
- **Tags:** workflows, scoring, audit, security
- **Supersedes:** —
- **Superseded by:** —

## Decision

A workflow document can accumulate a numeric score as an onboarding progresses, and
route or bypass steps on it. Six choices make up the design.

**Points are declared on the transition arm, not on the step.** A step declares
`scoring: { weight }`; every arm declares `points`, and the applied contribution is
`weight × points`. The arm the engine already resolves _is_ the outcome, so this needs
no new resolution logic and no second outcome vocabulary — and two `success` arms on
one step can score differently, which a status-keyed `outcomes` map cannot express.

**The score is stored per step, and a re-entered step replaces its own earlier
contribution.** `onboardings.score_by_step` is a jsonb map of step name to that step's
current contribution; `onboardings.score` is its sum, denormalized so the admin list
can sort and filter without aggregating jsonb per row.

**`$score` is a reserved condition variable, not a context key.** The `$` prefix marks
an engine-provided variable, a workflow field may not claim it, and `$score` is the
only member so far. Two integer-only operators — `gte` and `lt` — compare it. Both
halves of any band compose from those two, so `gt` and `lte` would be redundant.

**Skipping is a declared step block, validated as a DAG at load.** A step may declare
`skip: { when, target }`; when the condition holds at the moment the engine would
enter it, the target is entered instead, repeating while the newly entered step also
skips. Cycles, self-skips and unknown targets are refused when the revision is loaded,
so no runtime hop counter is needed. A terminal step may declare neither `scoring` nor
`skip`, and the initial step may not declare `skip`.

**Bypasses are recorded as lifecycle metadata, not as a new audit action.** Every
`onboarding.state_transition` and `onboarding.manual_review_decision` row carries
`scoreAfter`, `scoreDelta`, `stepScore` and `skippedSteps`.

**The score is admin-only.** It is absent from `GET /v1/onboardings/:id/state` and
from the submit response, and present on the admin list and detail endpoints.

## Context

The requirement was to decide which applicants deserve a closer look and which are
credible enough to be checked less thoroughly, expressed in the workflow document
rather than in code.

The engine already had almost everything needed: a declarative condition tree with an
evaluator, first-match transition arms with `when` guards, and a jsonb context
travelling with each onboarding. The one thing it lacked was a number to compare
against and the arithmetic to move it.

The decisive constraint was discovered by reading the shipped
`workflows/built-in/eu-b2c-individual-kyc-eea.workflow.json`. **It loops, in two
places.** `verify_phone_code` routes a `CHALLENGE_EXPIRED` refusal to
`resend_phone_code`, which returns to `verify_phone_code`; and `submit_kyc` routes a
`kycOutcome: retry` back to `select_document_type`, `capture_selfie` or
`collect_purpose`, each of which flows forward into `submit_kyc` again. A running
total that simply added on every application would therefore pay the applicant who
retried the most: five fumbled SMS codes would collect the phone step's points five
times, and the person having the most trouble would end up with the highest trust
score. That is the defect the per-step map exists to prevent, and it is why the
storage is a map rather than an integer.

## Alternatives considered

**A step-level `outcomes` map keyed by transition status** (`{ success: 10, rejected:
-20 }`) reads closer to the original request and needs no per-arm field. Rejected
because it cannot score two `success` arms differently, which is exactly what a
conditional arm exists to distinguish — a PL applicant and a US applicant leaving the
same step by different arms must be able to score differently.

**A single running-total integer with no per-step map.** Simpler, one column, no
recomputation. Rejected on the evidence above: it is correct only if the author sets
`points: 0` on every step reachable by a loop, which is an easy mistake to make and
invisible when made.

**A `repeat: "each" | "last"` knob per step.** Would let a step compound deliberately,
so repeated failure could read as an abuse signal. Deferred rather than rejected: the
per-step map makes it a one-line change later, and one fixed rule is easier to reason
about until something needs the other.

**`$score` as an ordinary context key.** Would need no variable registry at all.
Rejected because the context is the workflow's field namespace: a document could then
declare a field called `score` and silently collide with the engine's own value.

**`gt` and `lte` alongside `gte` and `lt`.** More familiar to write. Rejected as
redundant — `all: [gte 40, lt 80]` expresses any band, and four operators mean four
code paths to keep consistent.

**A dedicated `onboarding.step_skipped` audit action.** Rejected because a skipped
step is not a state the onboarding _entered_, and `ONBOARDING_TRANSITION_ACTIONS` is
defined as the states it did. Naming the bypass on the move that caused it keeps the
trail one row per move and gives the admin transitions view the information for free.

**Returning the score on the applicant-facing `/state`.** Convenient for a demo
front-end. Rejected: an applicant who can read their own risk score can binary-search
the thresholds and learn which answers earn trust.

**Indexing `onboardings.score`.** Planned, then dropped. The engine e2e asserts a
primary-key-only index inventory on that table, and the invariant is deliberate — the
table carries no index on `status`, `workflow_id`, `current_step` or `created_at`,
which the admin list already filters and sorts by. Indexing `score` alone would have
been inconsistent and would have required weakening a passing test. If the table ever
needs indexing, it should be one decision covering every column the list uses.

## Consequences

A workflow declaring no scoring is unchanged: normalization gives every step
`weight: 1` and every arm `points: 0`, so nothing accumulates and no route changes.
The `Normalized*` types make both fields required, so no consumer re-applies a default.

Scores are integers throughout — `weight` and `points` are both bounded integers — so
two runs of the same journey cannot land on different sides of a threshold through
floating-point drift.

A miswritten `skip` silently omits a compliance check. Three things bound that risk:
the skip graph is validated as a DAG at load, a terminal step may not declare one, and
every bypass is named in the audit trail on the move that caused it.

`scoreDelta` and `stepScore` differ on a re-entry — the total moved by less (or more)
than the step now contributes, because the earlier contribution was replaced. A reader
who assumes they are the same will misread every retry, which is why both are recorded.
