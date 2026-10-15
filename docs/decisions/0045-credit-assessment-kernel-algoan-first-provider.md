# 0045. Credit-assessment adapters share one kernel; a provider is a strategy, and Algoan is the first

- **Status:** Proposed
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

| Option                                                                                 | Why not                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A stand-alone `algoan_credit` adapter, kernel extracted when a second provider arrives | Repeats the KYC history: the banding, attempt and report rules would be written once for Algoan and re-derived later; the kernel is small and the plan already names the seams |
| Hosted Algoan Connect journey with a redirect channel on parked connectors             | The project has no Transaction Data product; Connect needs a `redirect_uri`, a browser leg and a new engine capability for a flow the demo cannot run today                    |
| Trusting the webhook body for the verdict                                              | The event carries only `{ customerId, analysisId }`; the score has to be read back regardless, and reading back makes reconcile and the callback share one path                |
| Verifying the signature over the whole request body                                    | Algoan signs `payload` alone with its own escaping; a whole-body HMAC never matches, and skipping verification would let anyone complete a parked onboarding                   |
| Engine-side polling of the analysis instead of webhooks                                | Needs a scheduler the engine does not have (0039 records none); webhooks arrive within a second of completion, and reconcile covers a missed one                               |
| Algoan credentials as environment variables                                            | Contradicts 0001; the sandbox credentials used for the Phase 0 spike live in `.env` only for that spike                                                                        |

## Consequences

Adding a provider is a `CreditProvider` and its HTTP client, a thin adapter subclass, one
registration line and a fixture pair; the kernel's specs cover banding, attempts and the report
cap. Algoan events for an analysis that is not the parked one re-park the step and are audited
as non-actionable. Operators must create Algoan subscriptions through the repository script so
the secret equals `callbackSigningSecret`; the console dialog takes no secret. Reversing the
kernel split costs one inlining refactor; reversing the "no Connect" scope is additive (a
redirect channel on parks) and is listed as future work in the plan.
