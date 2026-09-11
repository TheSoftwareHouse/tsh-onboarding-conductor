# 0012. Auditing non-success results: an observation-only filter, class names never text, per-throw-site suppression

- **Status:** Accepted
- **Date:** 2026-09-08
- **Tags:** audit, api, errors, security
- **Supersedes:** —
- **Superseded by:** —

## Decision

A global `ApiFailureAuditFilter`, scoped to `/v1` and bounded by a pending-write cap, now writes
an `api.request_rejected` (400–499) or `api.request_failed` (>= 500) audit row for every response
that previously produced no audit evidence. It extends Nest's `BaseExceptionFilter` and delegates
all serialization to `super.catch(...)` unchanged — it takes on no error-mapping responsibility,
changes no body, status or header, and adds no global error enum. The two-tier feature-local error
class convention (`docs/IMPLEMENTATION.md` §11, `packages/engine/CLAUDE.md`) is untouched. Audit
rows retain `errorName` (the exception class name) and `code` (the fixed contract code) but never
exception message text. Suppression of a row the filter would otherwise duplicate is per-throw-site,
via a non-enumerable `Symbol` marker (`markAuditRecorded`) set exactly where a domain audit row was
written, not per exception class.

## Context

The engine had no choke point where a non-success response could be observed: zero matches for
`@Catch`, `useGlobalFilters` or `APP_FILTER` across `packages/engine`. As a result, roughly 40
distinct 4xx responses, every `ValidationPipe` rejection, and every unexpected 500 produced no
audit evidence at all — an operator investigating a failed onboarding had no row to look at for
the majority of ways a request can fail. `docs/IMPLEMENTATION.md` §11 and `packages/engine/CLAUDE.md`
had deliberately ruled out a global exception filter, reasoning that a global error map becomes a
dumping ground and couples unrelated features. That reasoning was correct for what it was
protecting — the error-mapping responsibility that decides status and body per feature — and this
filter never takes on that responsibility, so the original concern does not apply to it.

Third-party SDK errors (Sumsub, Twilio, SendGrid) routinely embed endpoint URLs and query strings
that can carry API keys, so a free-text exception message is a credential-leak surface in a table
an operator is encouraged to read; `errorName` plus `code` gives enough to diagnose without that
risk, the same posture `connector.failure_*` already takes. `fieldErrors` is retained because all
three of its sources in this codebase — `InvalidStepDataException`, `ConnectorSettingsInvalidException`
and a custom `ValidationPipe` `exceptionFactory` — carry reason codes and key names, never values;
the custom `exceptionFactory` exists specifically so class-validator's rendered messages, which do
echo values for constraints like `@IsIn`, never reach a row. An unauthenticated caller can drive
4xx responses at will by probing `/v1`, so a global filter also needs a bound that prevents one
request from becoming one unbounded database insert. `OnboardingNotFoundException` is audited on
`submit` and on manual review but not on `GET /:id`, `GET /:id/state` or `GET /:id/transitions` —
so a suppression rule keyed to the exception class would wrongly suppress the routes that never
wrote a row, which is why the marker is set per-throw-site instead.

The alternative to the filter was to keep adding audit calls by hand at every throw site, which is
the status quo that produced the gap in the first place — every future error path would repeat the
same manual step or get missed, exactly as the ~40 existing ones were. Reopening the ruled-out
design and letting the filter also map errors to responses was rejected for the same reason the
original position exists: that is a second place deciding status and body, which is the coupling
`packages/engine/CLAUDE.md` warned against, not an observation. Suppressing by exception class
rather than by throw site was rejected because `OnboardingNotFoundException` is audited on some
routes and not others — a class-level rule would either double-log the audited routes or silently
drop the ones that were never recording anything. Recording the exception message for richer
diagnostics was rejected outright: third-party SDK errors embed URLs and query strings that can
carry API keys, and a message field turns the audit table into a credential-leak surface.

## Consequences

An operator investigating a failure now finds a row for a 404, a validation rejection or an
unexpected 500, where none existed before — including previously-invisible paths such as
`mapSubmitRejectedAttemptOutcome`'s `ONBOARDING_LOCK_REFRESH_FAILED` case, which write no domain
row and so surface only through this filter. Diagnosing further than `errorName` and `code` still
requires the application log, by design — the audit table remains a decision record, not a
debugging dump. The write-amplification bound means a sustained scan of `/v1` drops rows past the
cap rather than exhausting the connection pool, so an operator investigating an abuse spike may see
fewer rows than requests; the cap is a constant the same way the connector executor's is.

`auth.*` denials are the one deliberate exception to the one-row rule, and the reasoning is worth
keeping: marking them was implemented first and then reversed during review. The guard's write is
`void record(...).catch(...)` — fire-and-forget by design — so at the moment the guard throws, the
write has not merely gone unconfirmed, it has not been attempted. Marking therefore suppressed the
filter's row unconditionally, and a database failure would have left an auth denial with **zero**
audit evidence where the engine previously produced one row. Since auth denials are the
highest-value security evidence in this log, a guaranteed duplicate beats a possible zero: the four
denial throws are left unmarked and each writes both an `auth.*` row and an `api.request_rejected`
row. The cost is roughly double the rows on a scanner-driven 401 path, accepted knowingly. Making
the guard await its audit write would have given exactly one row, but it was rejected because it
puts a database write on the auth rejection path and converts a deliberately best-effort write into
a blocking one.

Reversing the filter is cheap — it is additive and observation-only, so removing it only returns the
engine to the prior, larger blind spot. Reversing the per-throw-site suppression convention is more
expensive, since it would mean re-deriving which throw sites already write a row from scratch.
