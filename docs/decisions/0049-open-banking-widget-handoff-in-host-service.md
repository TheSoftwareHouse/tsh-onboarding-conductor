# 0049. The open-banking widget handoff lives in the host service; the engine correlates through the provider's echo of the onboarding id

- **Status:** Accepted
- **Date:** 2026-10-13
- **Tags:** connectors, open-banking, onboardings, webhooks, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

**The widget handoff is the host service's, not the engine's.** Lean's LinkSDK is a browser widget
that needs a customer-scoped token minted with the Lean client secret. The host service creates the
Lean customer with `app_user_id` set to the onboarding id, mints the customer token, runs the widget
and submits the resulting `leanCustomerId` to the engine. For now that service is a dev-only harness
under `scripts/`; a BFF takes the role later. The engine hands no widget, token or URL to anyone.

**The engine correlates through the provider's echo of the onboarding id.** `lean_bank_data` accepts
a submitted `leanCustomerId` only when the Lean customer's `app_user_id` is this onboarding's id, and
refuses one that belongs to another onboarding or does not exist as `400 INVALID_STEP_DATA` on
`leanCustomerId`. It parks on the customer id as the provider reference and resumes from the signed
Lean webhook through the park of [0039](0039-parked-onboarding-lifecycle.md), resolving the onboarding
from the event's `app_user_id`, or from the customer record when the event carries only a customer id.

**Two choices made with the same connector.** A Lean refusal is rejected as
`CONNECTOR_REJECTED`, because `CONNECTOR_REJECTION_REASONS` is a closed set. The provider's reason
(`leanReason`) is logged by the engine, not audited: the `connector.result_rejected` audit row carries
only `reason: CONNECTOR_REJECTED`. The salary threshold lives in the connector
declaration's `config.minMonthlySalary`, and the adapter emits `salaryThresholdMet`, because the DDL
has no numeric field comparators (only `equals`, `in`, `isSet`).

## Context

A park carries no client-visible data ([0039](0039-parked-onboarding-lifecycle.md)) and `/state` does
not expose it, so the engine has no channel for handing a client anything a provider needs. No engine
step does so today: Veriff is driven through its API only ([0037](0037-kyc-connector-kernel-and-providers.md)),
and the client never touches the provider. Lean differs: the applicant links a bank inside Lean's
widget, which cannot start without a token only the holder of the client secret can mint.

## Alternatives

| Option                                                            | Why not                                                                                                                            |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The engine mints the token and exposes it on the park or `/state` | A contract change: client-visible park data and new `/state` fields. That is 0039's recorded follow-up, out of scope here          |
| Accept any `leanCustomerId` the client submits                    | A client could bind someone else's bank data to its onboarding; the `app_user_id` echo is what ties the customer to the onboarding |
| Add Lean's rejection reasons to `CONNECTOR_REJECTION_REASONS`     | The set is closed and shared by every connector; provider detail is logged, not audited                                            |
| Add numeric comparators to the DDL for the salary threshold       | A language change for one connector; the threshold in the declaration's `config` keeps the workflow, not the adapter, the owner    |

## Consequences

The engine's contract is unchanged: no migration, no new field on `/state`, and the harness is not part
of the Compose stack or CI.

A host service that uses Lean holds Lean credentials as well as the engine does, so the secret exists
in two places and a rotation touches both.

An applicant who abandons the widget leaves the onboarding parked. No scheduler reconciles it; an
operator finds it with the `parked` filter and reconciles it, as 0039 describes.

A park-exposed client action, so the engine can tell a BFF what to run next, remains the follow-up and
would replace the host service's side of this handoff.
