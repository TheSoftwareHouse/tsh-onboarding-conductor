# 0007. Connector retries and fallback chains run in-process, under hard bounds

- **Status:** Accepted
- **Date:** 2026-09-02
- **Tags:** connectors, workflows, reliability
- **Supersedes:** —
- **Superseded by:** —

## Decision

A connector declaration may name an ordered chain of fallbacks and a per-declaration
retry policy — `{"maxAttempts": 1..5, "delayMs": 0..5000}` — and the engine honours
both **inside the onboarding submit request**, waiting between attempts with
`setTimeout` from `node:timers/promises`. Nothing is queued, scheduled or persisted:
a retry is a loop in `WorkflowConnectorExecutorService`, and a process that dies
mid-chain fails the submit exactly as it does today.

Three bounds make that safe, and all three are enforced rather than documented:

- `CONNECTOR_RETRY_BOUNDS` — 1 to 5 attempts, 0 to 5000 ms between them — checked by
  the JSON Schema and again by the normalizer, so a definition built in code is bound
  as tightly as one loaded from disk.
- `MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH` — 3 fallback entries behind one primary.
- `MAX_CONNECTOR_SLOT_RETRY_DELAY_MS` — 20 seconds of waiting per connector slot,
  counted across the whole chain by the executor and overriding any further `retry` to
  `propagate` with `retry_delay_budget_exhausted` in the audit row.

This supersedes two boundaries the original fallback work set for itself — "no
fallback chains" and "no retry/backoff framework" — which were correct for that change
and are not constraints on this one.

## Context

The connector chain runs inside `OnboardingsService`'s `dataSource.transaction(...)`,
holding one of `pg`'s ten pooled connections and the onboarding's row locks for as
long as it runs. Waiting there is therefore not free in the way an interval between
two HTTP calls usually is: every millisecond declared in a workflow document is a
millisecond a pooled connection is held by a request doing nothing, and the condition
this feature exists for — a provider outage — is exactly when many onboardings are
waiting at once. The audit writes this same feature produces already had to be moved
off the caller's transaction for that reason.

Per-declaration bounds alone would not have contained it, because a chain multiplies
them: four links each allowed four waits of five seconds is eighty seconds of held
transaction from a document that breaks no individual rule. The per-slot budget is the
bound that cannot be talked around by authoring, which is why it lives in the executor
rather than in the schema.

The alternative was to schedule delayed retries as BullMQ jobs, which the engine
already runs for the webhook outbox. That removes the transaction concern outright and
allows intervals of minutes rather than seconds. It also needs persisted attempt state
per onboarding, a resume path back into the middle of a connector chain, and a
different answer to what a submit returns while its connectors are still being
retried — a feature in its own right rather than a detail of this one. Twenty seconds
of bounded in-process waiting covers what the request asked for (a few attempts,
seconds apart, before moving to the next provider) at a fraction of that cost.

## Consequences

An operator can express "try this provider three times 200 ms apart, then the next
one once, then the last one" in the workflow document alone, with no deploy. A
workflow declaring the maximum everywhere can add up to 20 seconds to one submit, and
a client's own request timeout — not the engine — is what decides whether that is
acceptable; the ceiling is a constant in the executor if it ever needs revisiting.

Retry state lives only in the call stack: a restart mid-chain loses it, and nothing
resumes. Intervals longer than five seconds, exponential backoff and jitter are not
expressible, and adding them means either raising these bounds knowingly or revisiting
the queued alternative above. A custom `ConnectorErrorHandler` can already vary _which_
action is taken per attempt; it cannot vary the interval.
