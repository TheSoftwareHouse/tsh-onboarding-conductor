# 0045. Credit-assessment adapters share one kernel; a provider is a strategy, and Algoan is the first

- **Status:** Accepted
- **Date:** 2026-10-15
- **Tags:** connectors, credit, bnpl, workflows, webhooks
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every credit-assessment adapter is one `CreditConnector` kernel plus one `CreditProvider`
strategy, on the pattern [0037](./0037-kyc-connector-kernel-and-providers.md) set for KYC. The
kernel (`packages/engine/src/connectors/adapters/built-in/credit/`) implements the flat
`ConnectorAdapter` port under the existing `credit` connector type and owns everything that is
the same whichever provider scores: parsing the step's derived config, reading the uploaded
bank-data document from object storage before the first provider call, resolving credentials
through `ConnectorSettingsService`, parking on a provider reference, correlating a callback
(actionable only for the parked assessment), reconcile, banding the score against the step's
`bands`, the attempt cap, and the closed audit-safe `submittedData`. A provider owns only the
wire: its id, settings schema and callback-auth recipe, `validateBankData`, `startAssessment`,
`parseCallback`, `buildReconcileEvent` and `fetchResult`, which maps the provider's state onto a
neutral `CreditResult` — `pending`, `failed { codes }` or `scored { score, report }`.

The kernel's outcome contract is closed: `creditOutcome ∈ { approved, review, declined, retry }`
plus the callback-only fields `creditScore`, `creditScoreBand`, `creditIndicators`,
`creditSecondaryScores`, `creditReasonCodes`, `creditAttemptCount`, `creditProviderReference`
and `creditReport`. A `failed` result becomes `retry` while the attempt count is below the step's
`maxAttempts`, then `review`. Every outcome is `accepted()`; the connector never returns
`rejected()` ([0005](./0005-kyc-connector-outcome-contract.md) pattern). `creditReport` is the
provider-shaped result the client renders, capped at 262 144 bytes compact JSON and redacted from
audit rows as `creditReportBytes`.

`algoan_credit` is the first provider, driven through Algoan's API only ("bring your own data"):
`POST /v1/oauth/token` (client credentials, cached for its `expires_in`), one customer per
onboarding with `customIdentifier` = onboarding id (a `422 ALREADY_EXISTS` is recovered by
`GET /v2/customers?filter=`), one analysis per attempt (`POST /v2/customers/{id}/analyses`
with the re-based bank data, `format: ALGOAN`, `dataOrigin: OPEN_BANKING`), the park reference
`${customerId}/${analysisId}`. The callback is Algoan's `analysis_completed` / `analysis_failed`
event, verified by the engine's HMAC port with the recipe Algoan documents and the Phase 0 spike
proved: SHA-256 over the Unicode-escaped JSON serialisation of `body.payload` alone (`/`, `<`,
`%`, `@` escaped), lower-case hex, header `X-Hub-Signature: sha256=<hex>`, secret = the
connector's `callbackSigningSecret`. An unsigned event is rejected. `fetchResult` reads the
analysis back (`COMPLETED` → scores, credit insights without their per-transaction arrays,
accounts, essentials and the first transactions page assembled into the report; `ERROR` →
`failed(error.code)`; anything else → `pending`) rather than trusting the webhook body.
Credentials (`clientId`, `clientSecret`, `callbackSigningSecret`) are connector settings entered
through the admin panel ([0001](./0001-runtime-connector-credentials.md)); the engine never
reads them from the environment. Algoan Connect (the hosted bank-connection journey) is out of
scope: the project has no Transaction Data product, and nothing here reserves a redirect channel.

A provider rejection is classified by the provider and mapped by the kernel, so `mock_credit` and
the next provider answer the client the same way (amended 2026-10-16; until then every Algoan 4xx
propagated as an uncoded 500). The provider port gains two domain errors beside
`CreditBankDataInvalidError`: `CreditProviderCredentialsRejectedError` and
`CreditProviderRejectedError { providerStatus, providerCode }`. On `startAssessment`, Algoan's
token or API answering 401 or 403 (wrong `clientId`/`clientSecret`, a product the project lacks)
is the first; `POST …/analyses` answering 400 or 422 is `CreditBankDataInvalidError` with Algoan's
`code` as the reason (never its `message`, which may echo the document); any other 4xx is the
second. The kernel's `execute` maps them: credentials rejected →
`CreditProviderCredentialsRejectedException` (503, `CREDIT_PROVIDER_CREDENTIALS_REJECTED`), logged
`CREDIT_PROVIDER_CREDENTIALS_REJECTED connectorId=…` at error level and never with a secret; bank
data invalid → the existing `invalidData` answer (the step stays, field error
`CREDIT_BANK_DATA_INVALID`, retryable, the client re-uploads); other rejections →
`CreditProviderRejectedException` (503, `CREDIT_PROVIDER_REJECTED`, with `providerStatus` and
`providerCode`). 5xx, timeouts and unreadable bodies stay `AlgoanUnavailableException` (503).
The client's submit route documents the two new exceptions; the BFF maps them onto its own
contract instead of a generic 502.

On the callback, `parseCallback` classifies the same way. A body the adapter cannot read as a
JSON object, or a payload without `customerId` and `analysisId`, is
`ConnectorCallbackPayloadInvalidError`, which the webhook route answers with 400
`CALLBACK_PAYLOAD_INVALID` (`AsyncCallbackPayloadInvalidException`) and audits as
`webhook.inbound_callback_rejected`, reason `payload_invalid`. A `customerId` Algoan answers 404
for (an event of another project on the same subscription, or a deleted customer) is
`ConnectorCallbackUnresolvedError`, answered 204 and audited with reason `callback_unresolved`,
exactly as the kernel already treats a `customIdentifier` that is not a UUID: the provider stops
redelivering an event that can never apply, and the drop stays visible. Until this amendment both
were a 500 (audited only as `inbound_callback_mapping_failed`) that the provider kept redelivering.
On reconcile, a park whose reference does not split into `customerId/analysisId` is
`PendingConnectorReconcileUnsupportedException` with the new reason `reference_malformed` (409)
rather than a 500.

A report-build failure after the score is known — any of the insights, accounts, essentials or
transactions reads failing inside `fetchResult` — still fails the whole callback with 503 and
leaves the onboarding parked for the provider's redelivery or an operator's reconcile; the
decision is not taken from the scores alone. That is the stance today: a partial report needs a
marker the client renders, which is deferred to the plan's follow-ups. Recovery from a lost
callback is manual and stays so: an operator finds the onboarding with the admin list's `parked`
and `parkedBefore` filters and presses "Check provider"
(`POST /v1/onboardings/{id}/pending-connector/reconcile`,
[0039](./0039-parked-onboarding-lifecycle.md)); no scheduler reconciles parked onboardings, and a
worker-role poller over `parkedAt` remains future work, reaffirmed on 2026-10-16 after a quick
tunnel outage parked three demo runs until they were reconciled by hand.

The step's `applicant` roles (0047) reach the kernel's `CreditSubmission.applicant`, and
`algoan_credit` sends none of them: Algoan's customer resource needs no applicant attributes for
the Credit Score and Payment Score products. The kernel passes what the workflow bound; a provider
uses what it has a use for.

## Context

The product needs BNPL underwriting that returns a credit score, with Algoan as the first
provider and others expected. The connector type `credit` already exists in the DDL contract but
no adapter implements it. The KYC work established that a second provider without a shared kernel
duplicates the engine-facing half and lets outcome semantics drift (0037); designing the shared
abstraction first, with one provider ported onto it, is the stated house rule. Algoan's sandbox
project has only the Credit Score and Payment Score products, so the data must be pushed by the
integrator, and Algoan signs its webhooks over the `payload` property only, which the engine's
generic HMAC verification cannot express without an adapter-supplied `buildSignedMessage`.

## Alternatives

| Option                                                                                 | Why not                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A stand-alone `algoan_credit` adapter, kernel extracted when a second provider arrives | Repeats the KYC history: the banding, attempt and report rules would be written once for Algoan and re-derived later; the kernel is small and the plan already names the seams   |
| Hosted Algoan Connect journey with a redirect channel on parked connectors             | The project has no Transaction Data product; Connect needs a `redirect_uri`, a browser leg and a new engine capability for a flow the demo cannot run today                      |
| Trusting the webhook body for the verdict                                              | The event carries only `{ customerId, analysisId }`; the score has to be read back regardless, and reading back makes reconcile and the callback share one path                  |
| Verifying the signature over the whole request body                                    | Algoan signs `payload` alone with its own escaping; a whole-body HMAC never matches, and skipping verification would let anyone complete a parked onboarding                     |
| Engine-side polling of the analysis instead of webhooks                                | Needs a scheduler the engine does not have (0039 records none); webhooks arrive within a second of completion, and reconcile covers a missed one                                 |
| A scheduled reconcile of onboardings parked longer than a delay                        | Proposed on 2026-10-16 after the tunnel outage and declined: the manual reconcile covers the demo, and a poller needs a worker role, cadence, backoff and audit actor of its own |
| Deciding from the scores when the report build fails                                   | Needs a partial-report marker the client renders; deferred, the callback fails whole and is redelivered or reconciled                                                            |
| Answering a 404 customer or a malformed callback payload with 500                      | The provider redelivers an event that can never apply, and the only trace is a mapping-failed audit row; a 204 or 400 ends the loop and names the reason                         |
| Algoan credentials as environment variables                                            | Contradicts 0001; the sandbox credentials used for the Phase 0 spike live in `.env` only for that spike                                                                          |

## Consequences

Adding a provider is a `CreditProvider` and its HTTP client, a thin adapter subclass, one
registration line and a fixture pair; the kernel's specs cover banding, attempts and the report
cap. Algoan events for an analysis that is not the parked one re-park the step and are audited
as non-actionable. Operators must create Algoan subscriptions through the repository script so
the secret equals `callbackSigningSecret`; the console dialog takes no secret. Reversing the
kernel split costs one inlining refactor; reversing the "no Connect" scope is additive (a
redirect channel on parks) and is listed as future work in the plan. The two provider exceptions
and the callback payload exception join the OpenAPI document; the BFF maps
`CREDIT_PROVIDER_CREDENTIALS_REJECTED` and `CREDIT_PROVIDER_REJECTED` to its own 503 so the
customer sees "the check cannot run right now" rather than a generic failure, and an operator
reads the connector id from the log line. A lost callback costs an operator action until a
poller exists.
