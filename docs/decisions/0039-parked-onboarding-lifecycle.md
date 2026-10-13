# 0039. A parked onboarding refuses submits, re-checks its park under the lock, and can be reconciled

- **Status:** Accepted
- **Date:** 2026-10-08
- **Tags:** onboardings, connectors, kyc, webhooks, admin-panel, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

**A parked onboarding accepts no client submit.** `OnboardingsService.submit` refuses, under the row
lock and after the completed guard, any submit that arrives while `pendingConnector` is set and
carries no connector continuation: `409 ONBOARDING_AWAITING_CONNECTOR`, with the park's
`connectorId`, `connectorName` and `connectorOrder` (never the provider reference). The refusal is
audited as `onboarding.rejected_attempt` with outcome `awaiting_connector` and notified to the client
webhook like the other refusals. A provider callback and an operator reconcile both carry a
continuation, so they pass; nothing else does. The step is the provider's to decide. When what the
provider decided is that the step's data is wrong — a continuation refused as
`400 INVALID_STEP_DATA` — the park is released in its own locked transaction after the refusing one
rolled back (`releasePark`: the park it names must still be held, or, for an adapter that names
none, the slot's connector order must match): the provider has delivered, and the step is the
client's again. Without that a mistyped one-time code would leave the onboarding behind the `409` for
good.

**A continuation names the park it was decided for, and the lock re-checks it.** The adapter reads
the park without a lock, compares provider references, fetches the verdict — all outside the
transaction, as before — and puts the park it correlated against on its result
(`ResolvedConnector.pendingConnector`). The submit path, once it holds the row, compares that with
what the row holds now (`OnboardingEntity.isParkedOn`: `connectorId`, `connectorOrder` and
`providerReference`). The comparison runs before the completed guard, so a late callback for an onboarding a reconcile or
another callback has since decided is acknowledged as superseded rather than refused with
`409 ONBOARDING_COMPLETED`, which the provider would retry. A mismatch throws `ConnectorCallbackSupersededError`; the submit path rethrows
it before any audit or notification, the webhook route records
`webhook.inbound_callback_rejected` with reason `callback_superseded` and answers `204`, and the
reconcile route reports `superseded`. Nothing is applied: the newer attempt's own callback decides
the onboarding. The verdict fetch stays outside the lock — a provider round trip under
`FOR NO KEY UPDATE` would hold the row for the provider's latency.

**The park is the only correlation source.** `AwaitingCallbackConnectorResolver` answers from
`pendingConnector` and from nothing else: a row on the step without a park logs
`AWAITING_CALLBACK_PARK_NOT_RECORDED` and resolves to `undefined`, which the KYC kernel turns into
`ConnectorCallbackAlreadyAppliedError` and the webhook route acknowledges. The flattened-chain match
that [0038](0038-runtime-connector-selection.md) kept for rows parked before migration `0031` is
deleted. `0031` never backfilled the column, but the branch is unreleased, so no deployed row is in
that state. The resolution's `pendingConnector` is therefore never `null`.

**The park records when it was written.** `ConnectorPendingExecution` gains `parkedAt` (ISO-8601).
The submit path stamps it on a fresh park (`stampParkedAt`) and leaves a re-park's stamp alone —
`buildParkedResult` spreads the stored record first, so the reference and the stamp survive an
acknowledged or superseded callback. `Workflow` stays clock-free. The admin summary exposes it
(`pendingConnector.parkedAt`, `null` for a row parked before it was recorded), and
`GET /v1/onboardings` filters on `parked`, `pendingConnectorId` and `parkedBefore`.

**An operator can reconcile a parked onboarding.** `POST /v1/onboardings/{id}/pending-connector/reconcile`
(admin, `200`) asks the parked connector's adapter for the verdict the provider holds and, when there
is one, applies it through the same `submit` call a callback uses — same lock, same park re-check,
same transition and client notification — under `origin: 'admin_reconcile'` and the operator's id.
The adapter port gains an optional `reconcilePending({ onboardingId })` answering
`{ outcome: 'still_pending' }` or `{ outcome: 'resolved', callback }`; the KYC kernel implements it
over a new `KycProvider.buildReconcileEvent`, with Veriff mapping "no decision yet" to `pending`
where a webhook read throws, and Sumsub reading the applicant as reviewed. A row with no park is
`409 ONBOARDING_NOT_AWAITING_CONNECTOR`; an adapter without the method, or a park with no provider
reference to read, is `409 PENDING_CONNECTOR_RECONCILE_UNSUPPORTED` with `reason: adapter` or
`reference_missing`. The response is `{ outcome: applied | still_pending | superseded, onboarding }`.
No scheduler runs it.

**Every reconcile leaves an audit row under the operator.** `onboarding.pending_connector_reconciled`
(`success`, written inside the submit transaction in place of `webhook.inbound_callback_applied`,
with the same submitted data and connector result plus the connector id) and
`onboarding.pending_connector_reconcile_noop` (`observed`, with the outcome), both actor type
`operator`, resource type `onboarding`.

## Context

The review of the Veriff work found three gaps in the same lifecycle. A parked KYC step's fields are
all optional, so an empty resubmit passed validation and re-ran the connector chain: a second paid
Veriff session, whose decision then raced the first's, and the earlier session's decision was
dropped by the reference guard. The callback path read the park with an unlocked `findOne`, fetched
the verdict, and then applied it under the lock without looking at the row again, so a submit or a
connector switch landing in between could have its attempt decided by a verdict for a different
one; and when the park was `null`, the legacy chain match skipped the reference guard altogether.
Nothing recovered an onboarding whose callback never arrived: `expiresAt` is never set, manual
review applies only `manual.*` arms, the admin list could not find a parked row, and
`VeriffClient.findDecision` existed but was called only from the webhook path.

## Alternatives

| Option                                                        | Why not                                                                                                                                                  |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Make a resubmit on a parked step idempotent (return the park) | Hides the client's mistake and still leaves the BFF with no signal; a refusal with the park's identity tells it what it is waiting on                    |
| Fetch the verdict inside the row lock                         | Holds `FOR NO KEY UPDATE` for a provider round trip; the re-check gives the same guarantee for the cost of a comparison                                  |
| Keep the flattened-chain match for `NULL` parks               | It is the path that skipped the reference guard; the only rows it served were pre-`0031` ones that no deployment holds                                   |
| A reconciliation poller in this change                        | A poller needs a worker role, a cadence and a backoff policy of its own; the route is the manual form of the same operation and lets the panel act today |
| Stamp `parkedAt` in `Workflow`                                | The domain is clock-free by design; the submit path already owns the moment of writing                                                                   |
| Reconcile through a new transition path                       | Would duplicate the lock, the park re-check, scoring and the audit row; routing through `submit` with an origin keeps one path and one set of guarantees |

## Consequences

A BFF that resubmits on a parked step now gets a `409` it must map to "wait and poll", not to a
terminal failure or a re-render; `creating-engine-bffs` says so. The `/state` descriptor does not yet
tell a client the onboarding is parked, so the `409` is the only signal a BFF gets — exposing the
park on `/state` is a recorded follow-up.

No scheduler reconciles stuck onboardings: an operator finds them with the list's `parked` and
`parkedBefore` filters and presses reconcile. A worker-role reconciliation poller over `parkedAt` is
the other recorded follow-up.

`parkedBefore` compares against `parkedAt`, so a row parked before the stamp existed has `NULL` there
and never matches; its summary shows `parkedAt: null`. A provider whose adapter has no read-back
cannot be reconciled and is told so (`reason: adapter`); waiting for the callback, or manual review,
remains the only way forward for it.

A callback that was decided for a superseded park is dropped silently from the client's point of
view: no error notification, only an audit row. That is deliberate — the onboarding never had the
error — but it means a provider whose callbacks keep landing as `callback_superseded` is visible
only in the audit log.
