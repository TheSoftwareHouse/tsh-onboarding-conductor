# 0034. KYC adapters share one kernel; a provider is a strategy, and Veriff is the second

- **Status:** Accepted
- **Date:** 2026-10-05
- **Tags:** connectors, kyc, workflows, webhooks
- **Supersedes:** —
- **Superseded by:** —

## Decision

Every identity-verification adapter is one `KycConnector` kernel plus one `KycProvider` strategy.
The kernel (`packages/engine/src/connectors/adapters/built-in/kyc/`) implements the engine's flat
`ConnectorAdapter` port and owns everything that is the same whichever provider answers: parsing
the step's derived config, resolving and reading every captured document before the first
provider call, building the applicant from the canonical roles, resolving credentials through
`ConnectorSettingsService`, correlating a callback (UUID guard, redelivery guard, re-park for a
non-actionable event), the outcome contract of [0005](./0005-kyc-connector-outcome-contract.md),
the identity guard, the attempt cap, the closed audit-safe `submittedData`, and the log lines. A
provider owns only the wire: its id, settings schema and callback-auth recipe, `submit`,
`parseCallback`, `fetchVerdict` and an optional `onRetry`. It maps its own states onto a
provider-neutral `KycVerdict` — `pending`, `needs_review`, `approved`, `declined`,
`resubmission` — and throws for a state it cannot map, so the callback answers 5xx and the provider
redelivers. `sumsub_kyc` is ported onto the kernel with its behaviour preserved; `veriff_kyc` is
the second provider; the adapter classes are thin subclasses that inject their provider.

The engine-level port stays flat and keyed by `id`. `docs/IMPLEMENTATION.md` §4 records why the
spec's connector categories were removed — the engine never needs to know that a call "is KYC" —
and nothing here reintroduces one: the kernel is an adapter-layer base, invisible to the executor,
the registry and the webhook route.

Three consequences for the step and the workflow documents:

- The `kyc-identity-verification` step requires only provider-neutral keys (`connector`,
  `sourceKey`, `maxAttemptsPerDocSet`). Provider-specific keys belong under `connector.config`,
  the binding's extras, and reach the provider as `providerConfig`. Sumsub's `levelName` and
  `questionnaireDefinitionId` stay accepted at the step level so every stored, immutable revision
  keeps validating; the Sumsub provider still refuses a declaration without them at boot.
- The step declares a fifth callback field, `kycAttemptCount`. A provider that reports attempts
  itself (`countsAttempts: true` — Sumsub's per-docSet `attemptCnt`) never writes it, so its wire
  shape is unchanged; for one that does not (Veriff), the kernel counts total resubmissions per
  onboarding there and caps at `maxAttemptsPerDocSet`.
- A fixed document `country` in config is accepted as alpha-2 or alpha-3 and normalised to
  alpha-2 in the kernel; a provider converts at submit (Sumsub to alpha-3).

Veriff is driven through its API only — create a session, upload the captured images, mark the
session submitted — never through a Veriff UI; the end user sees only the engine's capture steps,
exactly as with Sumsub. A new session is created on every execute, so a retry route never depends
on Veriff's own resubmission state machine. The verdict is read back from
`GET /v1/sessions/{id}/decision` rather than taken from the webhook body, as Sumsub's is. A
`review` decision parks the step: a final decision follows. Veriff signs both directions with one
shared secret, so `ConnectorCallbackHmacAuth` gains `secretSettingKey` and the adapter names
`sharedSecretKey` as the inbound signing secret — an amendment to
[0006](./0006-callback-signing-secret-in-connector-settings.md), whose default
`callbackSigningSecret` stands for every other adapter.

## Context

The first draft of this work copied the Sumsub adapter into a second stand-alone Veriff adapter.
That duplicates the engine-facing half — 800 lines of document resolution, correlation, outcome
mapping and audit shaping — and a third provider would copy it again, each copy free to drift in
what `human_review` or `retry` means. The stated goal is the opposite: one KYC connector that
Sumsub and Veriff both plug into, that an operator can switch between at runtime
([0035](./0035-runtime-connector-selection.md)), and that a future provider joins without touching
the step type, the engine or the workflow documents. That goal is only reachable if the outcome
semantics live in exactly one place.

The Sumsub adapter already separated "what Sumsub said" from "what the workflow sees"
([0005](./0005-kyc-connector-outcome-contract.md)); this record moves the second half out of the
adapter and into a kernel every provider shares, and narrows a provider to the first half.

## Alternatives

| Option                                                                               | Why not                                                                                                                                                                                    |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A second stand-alone adapter copied from `sumsub_kyc`                                | Duplicates the engine-facing half per provider; the outcome contract, attempt cap and identity guard drift independently, and a third provider copies the drift                            |
| An engine-level KYC category interface and `(category, providerId)` resolution       | Reinstates what `docs/IMPLEMENTATION.md` §4 removed on purpose: the engine gains a taxonomy every provider must be forced into, for no capability the flat port lacks                      |
| The provider as a connector _setting_ under one `kyc` id                             | Credentials, the webhook route (`/v1/webhooks/<id>/callback`) and runtime selection all key on the id; one id would mean one credential set and one webhook URL for every provider at once |
| Reusing one Veriff session across resubmissions and reading its attempt count        | Depends on a resubmission state machine Veriff documents for its SDK, not for API-only uploads; a fresh session per execute is self-contained, and the kernel's own counter gives the cap  |
| Declaring `kycAttemptCount` only in the Veriff workflow files via an included `form` | Makes the two families differ in more than the connector binding, and leaves a Sumsub-authored step unable to count attempts once selection switches it to Veriff                          |
| Leaving Sumsub as it is and sharing the kernel only between new providers            | Two shapes of KYC adapter to maintain, and the selection feature could not promise the same outcome semantics on either side of a switch                                                   |

## Consequences

Adding a provider is a `KycProvider` and its HTTP client, a ten-line adapter subclass, one
registration line, a fixture workflow pair and the docs; the kernel's specs already cover the
rest. `docs/EXTENDING.md` carries the recipe.

The Sumsub port is a refactor of live provider code. Its connector spec is kept case by case as
the regression net, with one deliberate alignment: a non-RED, non-GREEN review answer with an
identity mismatch used to land in `human_review` and now throws like every other unexplained
provider state. Object-storage reads now happen before the Sumsub level check; the level check
still precedes `createApplicant`, so a drift still costs nothing at Sumsub.

The compiled form of the stored Sumsub v2 gains an optional field the hand-written v1 lacks;
`eu-b2c-revision-equivalence.spec.ts` pins that one difference, as it already pins the OTP step.
A hand-written step that lacks `kycAttemptCount` cannot carry a Veriff retry verdict, which is
why phase 2's selection refuses such a switch (`callback_fields_missing`).

The attempt cap means two different things: per docSet at Sumsub, total resubmissions per
onboarding at Veriff. `maxAttemptsPerDocSet` keeps its name for the stored revisions' sake and the
documentation states both readings. An `expired`/`abandoned` Veriff decision routes to
`retry.IDENTITY` without counting towards the cap — it should not occur at all in API-only mode,
where the session is submitted inside the same `execute`.

Reversal is moderate: the provider interface and the kernel are additive, and the Sumsub-specific
modules keep their names, so folding the kernel back into one adapter is a move, not a rewrite.
