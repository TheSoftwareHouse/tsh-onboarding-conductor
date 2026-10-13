# 0005. The `sumsub_kyc` adapter reports a domain outcome; the workflow routes it

- **Status:** Accepted
- **Date:** 2026-08-27
- **Tags:** connectors, kyc, workflows
- **Supersedes:** —
- **Superseded by:** —

## Decision

The `sumsub_kyc` connector adapter never chooses the onboarding's next step. On its
async callback path it evaluates Sumsub's verdict — the review answer, the screening
case, the declared-versus-verified identity comparison, the per-docSet retry count —
against an ordered decision table and reports exactly one of four domain outcomes:
`verified`, `human_review`, `retry`, `refused`. Every one of them is returned to the
engine as `ConnectorExecutionResult.accepted()`; the adapter never returns
`rejected()` and does not declare `canReject`. The outcome rides `submittedData` as
`kycOutcome` (with `kycRetryStep` set only on `retry`), and the workflow document —
`workflows/fixtures/sumsub-kyc.workflow.json` — is what routes on it, with four
`status: success` transitions distinguished by `when` conditions on `kycOutcome`. A
provider state the decision table cannot explain throws rather than defaulting to an
outcome, so the callback answers `5xx` and Sumsub redelivers instead of a guess being
applied.

## Context

Two existing engine contracts were candidates for carrying this decision, and neither
fits. `ConnectorRejectionReason` — the type a `rejected()` result's `reason` must be
drawn from — has four members (`ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`,
`CHALLENGE_NOT_FOUND`, `CONNECTOR_REJECTED`), none of which means "identity refused",
still less "refused pending a manual look" or "send the customer back to one specific
capture step". `WorkflowTransitionStatus` is only `success | rejected | manual.approve
| manual.reject | manual.invalid`; there is no status that means "route on a value the
connector produced". Bending either contract to fit a KYC-specific vocabulary would
special-case one adapter's domain inside a shared engine type, and the next connector
needing its own multi-way verdict — a credit check, a bank-verification tier — would
still not fit it.

The alternative already existed in the engine: a workflow step's `data` and
`transitions` can express an arbitrary closed set of outcomes with no engine change,
because `when` conditions read connector-submitted step data exactly like any other
field. So the adapter's job narrows to "produce the fact", and the workflow document's
job is "act on it" — the same separation the engine already draws between what a
connector can observe and what a workflow author decides to do about it.

## Alternatives

| Option                                                                                                                         | Why not                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Add a `kycOutcome` (or similar) member to `WorkflowTransitionStatus`                                                           | Couples a shared engine type to one connector's domain; the next connector needing a multi-way verdict needs its own status, and the type stops being closed                                                                                                                                                                                        |
| Extend `ConnectorRejectionReason` with KYC-specific reasons and return `rejected(reason)` for `human_review`/`retry`/`refused` | `rejected()` is a boolean outcome the workflow's `rejected`-status transition consumes; it cannot express "retry, and specifically re-collect the SELFIE docSet" without `submittedData` doing that work anyway, so the enum buys nothing and still needs `canReject` declared and a `rejected`-status target wired for verdicts that are not final |
| Give `ConnectorAdapter` a new return shape purpose-built for "accepted with routing data"                                      | The plan's own scope excludes changing `ConnectorCallbackResult`, `ConnectorExecutionResult` or `ConnectorAdapter` — the existing contract already carries `submittedData`, which is exactly this data, so a new shape would duplicate a channel that already exists                                                                                |
| Have the adapter call an engine service to force a specific transition                                                         | Inverts the ownership the engine already establishes: connectors report facts, workflows decide transitions. It would also make the adapter aware of workflow-document structure it has no other reason to know                                                                                                                                     |

## Consequences

Two deployments can treat the same provider verdict differently — routing a PEP hit to
`human_review` in one workflow and to a stricter `refused` path in another — with no
code change, only a different `workflows/users/*.json` document. That is the entire
point: the workflow document, not the adapter, is where a deployment's compliance
policy lives.

The cost is that `kycOutcome`, `kycRetryStep` and the docSet keys they draw from
(`IDENTITY`, `SELFIE`, `APPLICANT_DATA`, `QUESTIONNAIRE`) become a wire contract a
workflow author must restate as `oneOf` literals on the step's `data` fields — the DDL
has no way to reference an adapter's own constants, so `sumsub-contract.ts` and the
workflow JSON necessarily repeat the same four and four strings. That duplication is
accepted as the cost of an external wire contract (`.claude/rules/constants.md`
permits it explicitly), not treated as drift to eliminate.

It also means the outcome contract is only as good as the workflow document's routing:
an author who wires only three of the four `kycOutcome` values, or omits the
`kycRetryStep` guard, gets a step that silently falls through rather than a startup
failure naming the missing case — `collectConditionReferences` requires every
condition field to be declared, but nothing requires every value of a `oneOf` to be
routed. Task 4.1's workflow document routes all four deliberately; a future author
copying it has to do the same by discipline, not by a check the engine enforces.

> **Amended 2026-10-05 by [0037](./0037-kyc-connector-kernel-and-providers.md):** the outcome
> contract is now owned by the shared `KycConnector` kernel for every KYC provider, not by the
> `sumsub_kyc` adapter alone. A provider reports a neutral `KycVerdict`; the kernel turns it into
> `kycOutcome`/`kycRetryStep` and the routing stays in the workflow document exactly as decided
> here. The callback fields gain `kycAttemptCount`.
