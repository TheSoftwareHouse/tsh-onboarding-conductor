# 0008. Onboarding scoring: transitions-only, sum-then-clamp-once, a dedicated column

- **Status:** Accepted
- **Date:** 2026-09-04
- **Tags:** workflows, ddl-schema, scoring, security
- **Supersedes:** —
- **Superseded by:** —

## Decision

A workflow may declare named numeric scores at its root — `scoring: { <name>: { min, max } }` —
and adjust them from step data with a per-step `scoring: [{ score, when?, add }]` list. Three
choices shape how that works:

**The score condition leaf is legal only inside a transition's `when`.** `{ score, gte | gt | lte
| lt }` composes inside `all` / `any` / `not` like any other condition, but a field's `when` and a
scoring rule's own `when` may not contain one. The JSON Schema enforces this with a separate
`transitionCondition` definition family (`transitionCondition`, `transitionConditionAll/Any/Not`,
`conditionScoreComparison`) that only a transition's `when` points at; the normalizer enforces the
same restriction independently, because a runtime-registered field type can change the schema —
`ConditionNormalizationContext` gains an optional `declaredScores`, set only while normalizing a
transition's `when`, and a score leaf reaching the normalizer without it fails.

**A step's scoring rules are summed, then clamped once.** Every rule whose `when` holds (a rule
with no `when` always holds) contributes its `add` to a running total; only after every rule on the
step has been summed is each touched score clamped to `[min, max]`, a single time. Declaration
order therefore never changes the outcome. An onboarding starts each declared score at its `min`.

**Scores persist in a dedicated `onboardings.scores jsonb NOT NULL DEFAULT '{}'::jsonb` column**
(migration `0019`), not inside the existing `context` column.

## Context

**Transitions-only.** `GET /v1/onboardings/:id/state` publishes each field's `when` verbatim so a
client can re-resolve field visibility as the form fills — the server resolves against persisted
context while a form's conditions depend on values the user is still typing, so the client has to
be able to redo that resolution locally. A score leaf in a field's `when` would either break that
contract (the client cannot evaluate a condition it cannot compute) or force the engine to publish
live scores to the end user, which tells a customer exactly how to re-answer to clear a threshold.
Transition resolution happens server-side only, in `Workflow.evaluateTransition`, so the leaf costs
nothing there. Excluding a scoring rule's own `when` follows from the same shape: the rules that
produce a step's new scores cannot also read them without making declaration order significant,
which the next decision exists to rule out.

**Sum-then-clamp-once.** Clamping after every individual `add` makes `+40, -10` and `-10, +40`
produce different results near a bound, turning JSON array order into hidden semantics no author
would expect from declarative rules. Clamping once, after the step's contributions are fully
summed, keeps a step's effect a plain sum regardless of how its rules are ordered. Starting each
score at its `min` rather than `0` or `null` means every score is well-defined from the first
transition, with no special-cased "unset" state a `when` clause would otherwise need to guard
against, and no score can silently start outside its own declared bounds.

**A dedicated column, not `context`.** `context` already means "persisted field values a connector
or a `when` clause may read," and a `persist: false` field is deliberately excluded from it — the
whole point of that flag is that a submitted value never reaches storage. Scoring is designed to
read exactly such fields (a `persist: false` `highRiskChannel` driving a `risk` score is the
worked example), so writing the resulting score back into `context` would make it indistinguishable
from a persisted field value and would blur the flag's guarantee. A score is also a derived,
decision-relevant number, not raw applicant data: it belongs in the audit trail on its own terms
(`AuditLifecycleMetadata.fromScores` / `toScores`, allowlisted like every other lifecycle field) and
on the admin summary, but explicitly not in the end-user `/state` payload — a distinction that is
easy to enforce on a typed column and easy to get wrong by convention inside an untyped jsonb bag
that already serves a different purpose.

## Consequences

A workflow author gets banding (`gte: 70`, `lte: 20`) on an accumulated value with no `equals` or
`in` comparator to misuse on a computed integer, and can drive a score from a field the onboarding
never stores. An operator sees the resulting score on the admin onboarding details page and in the
audit trail for every state transition and manual review decision, without it ever reaching the
customer-facing API.

The cost is one column and one code path an implementer must remember: scores are recalculated
exactly once per resolved transition, immediately before target resolution and after the connector
chain, so a parked async connector does not score and its callback resume scores once when the
chain finally resolves; a manual-review decision passes the current scores through unchanged, since
it submits no step data for a rule to read. Getting that placement wrong — scoring right after data
collection, for instance — would double-apply a step's rules on an async connector step, because
`Workflow.evaluate` runs a second time on callback resume.

Score-gated field visibility and connector-driven scoring are both ruled out by the transitions-only
leaf and stay out of scope; either would need `/state` to publish live scores to the client, which
is the exact leak this decision avoids.
