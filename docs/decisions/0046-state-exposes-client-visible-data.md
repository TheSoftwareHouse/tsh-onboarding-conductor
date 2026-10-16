# 0046. A step marks fields client-visible and `/state` exposes them with the pending park

- **Status:** Accepted
- **Date:** 2026-10-15
- **Tags:** onboardings, api, step-types, connectors, bnpl
- **Supersedes:** —
- **Superseded by:** —

## Decision

A step type may mark a field `clientVisible: true` in `buildFields`, and
`GET /v1/onboardings/{id}/state` gains two additive members: `data`, an object holding the
current context value of every client-visible field of every step already passed, and
`pending`, either `null` or `{ connectorId, parkedAt }` while a connector is parked. No other
field reaches `data`; callback-only fields that are not marked stay invisible to the client as
they are today. `pending` mirrors the admin `pendingConnector` DTO without `providerReference`.
The `credit-assessment` step marks `creditOutcome`, `creditScore`, `creditScoreBand`,
`creditIndicators`, `creditSecondaryScores`, `creditReport` and `creditAttemptCount` (so a client can
say which attempt a retry is); the KYC step marks nothing. With `report: 'full'`, `creditReport`
holds the accounts with their identifiers masked by the adapter and the first page of transactions
as the provider returns them — dates, amounts, descriptions, categories — not masked; `'summary'`
holds scores and metadata only, `'none'` nothing (0047). `clientVisible` is authorable on any raw root field of a workflow
document, not only through `buildFields`.
`onboarding.state_changed` keeps carrying no outcome data; a client re-fetches `/state`.

## Context

`/state` returns the current step's fields with their values, so a value a connector wrote on a
step that has since advanced is unreachable by the client. A credit check whose whole purpose is
to show the applicant a score therefore has no public channel for it, and a client cannot tell
"the provider is computing" from "nothing has happened". The BNPL demo needs both, and the
admin-only routes are not an option for a public client.

## Alternatives

| Option                                                      | Why not                                                                                                                             |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Carry the outcome in the `onboarding.state_changed` webhook | Moves client-facing data into an unsigned delivery and duplicates `/state`; the client still needs `/state` for the rest            |
| Expose the whole context under `/state`                     | Leaks every callback-only field of every step (KYC verdict details, provider references); opt-in per field keeps the default closed |
| A credit-specific public route (`/credit-result`)           | One route per step type does not scale and would re-implement the step walk `/state` already does                                   |
| Put the score and report in the terminal step's fields      | Terminal steps have no fields, and the data belongs to the step that produced it                                                    |

## Consequences

`OnboardingStateResponseDto` gains `data` and `pending`, so the OpenAPI document is regenerated
and the documentation site's API page bumps. Existing clients see two new members and nothing
removed. A step author who marks a field must treat its value as public; the step-type registry
tests assert which fields each built-in step exposes. `data` is bounded by the report cap of
[0045](./0045-credit-assessment-kernel-algoan-first-provider.md), so a `/state` response stays
under 300 KB.

`/state` is authenticated by the onboarding id alone, like every client route, and
`algoan_credit` sends that same id to Algoan as the customer's `customIdentifier` (0045), so
whoever holds the id — the client, an operator, the provider — can read the report, transactions
included (stated 2026-10-16). That is accepted: the demo BFF keeps the id server-side and hands the
browser a session token, and a workflow that must not expose the transactions sets
`report: 'summary'` or `'none'`. Masking the client-visible transactions and sending the provider
an opaque per-onboarding identifier are follow-ups in the plan, not part of this decision.
