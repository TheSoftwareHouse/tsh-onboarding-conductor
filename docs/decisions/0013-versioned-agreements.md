# 0013. Versioned agreements: a family `key` plus a monotonic `version`, status derived by a view

- **Status:** Accepted
- **Date:** 2026-09-09
- **Tags:** agreements, workflows, persistence, webhooks
- **Supersedes:** —
- **Superseded by:** —

## Decision

Terms and conditions stop being a hardcoded `termsVersion` string in a workflow document and
become a first-class versioned entity the engine owns. Nine choices shape it.

**1. The concept is called _agreement_, never "document".** `documents`,
`onboarding_documents`, `OnboardingDocumentEntity` and `POST /v1/onboardings/:id/documents`
already mean _uploaded files_ in this engine (§7 of `docs/IMPLEMENTATION.md`) — an applicant's
passport scan, reserved and then completed against object storage. Reusing the word for a text an
applicant ticks a box against would make every `document` identifier ambiguous at the exact points
the two features meet: the onboarding they both hang off, and the audit trail they both write to.
The discipline is absolute rather than a preference — no table, column, route, type or identifier
in this feature uses the bare word.

**2. Acceptance status is derived on read, never stored on `onboardings`.** A single
`onboarding_agreement_statuses` view computes `current` / `outdated` / `not_accepted` per
onboarding from the link rows; `onboardings` gained no column. A `@ViewEntity` maps it so the
existing paginated admin list can `leftJoinAndMapOne` it and filter on it.

**3. The webhook fires per onboarding, when an agreement is linked to it** — not once at publish
time. This keeps `client_webhook_outbox` onboarding-scoped exactly as it is: `onboarding_id` stays
`NOT NULL` and the endpoint still comes from that onboarding's own workflow root `notify.path`.

**4. Publishing auto-links.** A new version is written as a `pending` link to every onboarding
whose highest accepted version of the family is now behind, and each link enqueues its own
`onboarding.agreement_pending` row. The explicit `POST /v1/onboardings/:id/agreements` endpoint
still exists for the out-of-band case.

**5. A family is a `key` plus a monotonic `version`; `type` classifies the family.**
`UNIQUE (key, version)` and `CHECK (version > 0)`; the version is derived inside the insert as
`MAX(version) + 1`. `type` is drawn from `AGREEMENT_TYPES` and belongs to the family rather than
to one version, so publishing under an existing `key` with a different `type` is
`AGREEMENT_TYPE_MISMATCH`.

**6. Engine API only.** `packages/admin-panel` is not touched. The engine surface is the contract;
an operator UI over it is a separate change.

**7. An agreement carries no `name`.** `key` and `type` identify the family. A display label lives
on a version row, so two versions of one family would sooner or later disagree about what the
family is called, and nothing could say which was right.

**8. The verb is _accept_, never "sign".** `e_signature` is already a distinct `ConnectorType` in
this engine, and a ticked boolean is not a signature. Status `accepted`, column `accepted_at`,
route `/accept`, audit `agreement.accepted`, DDL `acceptedWhen`.

**9. One event, one trigger: a link created out of flow.** Publishing emits no event of its own —
it notifies only because it creates links. The links `OnboardingsService.start` creates are
deliberately silent: those families are collected by the workflow step itself, and
`onboarding.state_changed` already fires for the creation.

## Context

**Why the word matters more than it looks.** The engine already carries one `documents` concept,
and it is the heavier one: a reservation lifecycle, staging and final object keys, requested versus
verified content type and size, an expiry. An agreement is none of that — it has no body, no bytes
and no storage. The two would have collided on `onboarding_documents` versus a hypothetical
`onboarding_documents` for consents, and on an audit trail where `document.*` would have meant two
unrelated things. "Agreement" was chosen because it is the word that stays unambiguous in the
places both features are read together, not because it reads better in isolation.

**Why a view rather than a column.** A stored `onboardings.agreement_status` fails three ways, and
each of them is silent. Publishing v2 would have to bulk-`UPDATE` every affected onboarding, which
is a write amplification of the whole table on an operator action that logically touches one row.
That `UPDATE` races a concurrent acceptance of v1 — the two interleave and whichever commits last
wins, so the stored label can end up describing neither state. And the column goes stale the first
time any write path forgets to maintain it, which is the failure mode that produces a wrong answer
rather than an error. The view cannot be wrong: it is recomputed from the link rows every time it
is read, and the link rows are the only thing anybody writes.

**Why a view rather than a raw subquery.** `paginateQueryBuilder` calls `getMany()`, which drops an
`addSelect` of a raw expression. A `@ViewEntity` joined with `leftJoinAndMapOne` hydrates through
`getMany()` and gives `andWhere` a column to filter on, so the derived status reaches both the list
projection and the list filter through one mechanism.

**Why the link table is keyed by `(onboarding_id, agreement_id)`.** An onboarding legitimately
holds two rows for one family at once — v1 `accepted` beside v2 `pending` is precisely what
"outdated" means. Keying by `(onboarding_id, key)` would have made that state unrepresentable and
forced the outdated case into a flag somewhere else.

## Alternatives

| Option                                                                   | Why not                                                                                                                                                                                                                                    |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Extend the existing `documents` / `onboarding_documents` feature         | It models uploaded bytes with a reservation lifecycle, an expiry and object-storage keys, none of which an agreement has; sharing the noun would make every `document` identifier in the engine ambiguous                                  |
| Store `agreement_status` on `onboardings`                                | Needs a bulk `UPDATE` of the table on every publish, races a concurrent acceptance, and silently goes stale the first time a write path forgets it — all three fail by returning a wrong answer rather than an error                       |
| Keep the version in the workflow document (`termsVersion`, as before)    | A version in a document is a deployment artefact: publishing a new one means editing and re-loading a workflow revision, and nothing records which version any existing onboarding actually accepted                                       |
| Give an agreement a `name`                                               | The label would sit on a version row and drift between versions of one family, with no rule for which version's label is the family's                                                                                                      |
| Emit one webhook event at publish time                                   | `client_webhook_outbox.onboarding_id` is `NOT NULL` and the endpoint is resolved from an onboarding's own workflow; a publish-scoped event has no onboarding, so it would need a second outbox shape for one event type                    |
| Also notify for the links created at onboarding start                    | Those families are collected by the workflow step the user is about to walk, the client already renders them from the `/state` descriptor, and `onboarding.state_changed` fires for the creation — a second event would be duplicate noise |
| Gate `POST …/agreements/:agreementId/accept` on the onboarding lifecycle | An approved customer still has to be able to accept a new version of the terms; refusing would leave them permanently `outdated` with no route back                                                                                        |
| Record acceptance against the version linked at onboarding start         | See Consequences — the publish fan-out only links onboardings holding an _accepted_ row below the new version, so an onboarding that accepted v1 late would land `outdated` with no pending link and no `agreementId` left to accept       |

## Consequences

An operator publishes a new version with one `POST /v1/admin/agreements` call and the engine
answers, for every onboarding, which version it accepted and whether that is still the latest —
through `GET /v1/onboardings/:id/agreements` per family, through `agreementStatus` on every admin
summary, and through `GET /v1/onboardings?agreementStatus=outdated` as a list filter. A client
system learns per onboarding, not by polling: one `onboarding.agreement_pending` webhook per link
the publish created, carrying the new version and the version that onboarding had accepted before.
`WebhookEventPayload` becomes a union discriminated on `event.type`; the `onboarding.state_changed`
arm is byte-identical to before.

A workflow author declares only the family — `"agreements": [{ "key": "eu-b2c-terms",
"acceptedWhen": "termsAccepted" }]` — and never a version, which is what stops documents going
stale on the next publish. The cost is a startup coupling in the other direction: a workflow
declaring a family nobody has published fails every onboarding start on it with `503
AGREEMENT_NOT_PUBLISHED`, the same reading as `CONNECTOR_NOT_CONFIGURED`. Publishing the family is
a deployment step, not an afterthought.

**Submit records the family's latest published version, not the version linked at start.** A step
declaration names only a `key`, so the version has to be resolved at acceptance time, and the case
that forces the choice is an onboarding that started against v1, had v2 published under it
mid-flow, and then submitted the accepting step. Recording v2 leaves the v1 `pending` link created
at start dangling and means the engine records acceptance of a version the user was arguably never
shown — notional today, since the engine stores no agreement content, but it is the
compliance-flavoured half of the trade. Recording v1 would be truer to what the flow walked the
user through, but the publish fan-out links only onboardings holding an _accepted_ row below the
new version, and at publish time this one held only `pending` v1 — so it was never linked to v2 and
would land `outdated` with nothing to accept, recoverable only through an explicit link call.
Neither is free; the implemented behaviour was chosen because it strands no onboarding. Reversing
it is contained to the version-resolution step inside
`OnboardingsService.acceptDeclaredAgreements` and its tests.

Every link the engine creates on its own initiative — the start links and the whole publish fan-out
— writes an `agreement.linked` audit row carrying its `origin`, because a decision the engine took
without an operator naming the affected onboarding belongs in the trail rather than only in the
application log. That is also the shape of the remaining cost: the fan-out runs synchronously
inside the publish request, writing a link, an audit row and an outbox row per affected onboarding,
which is bounded only by how many there are.

Three gaps are left open deliberately. The entity records identity and version, never content or a
URL, so nothing serves the text an applicant accepted. There is no way to retire a family, so a
`key` dropped from every workflow still counts toward an onboarding's derived status through its
existing links. And nothing blocks an onboarding from progressing while it owes a version —
expressing that would need the derived status to become readable from a transition condition. The
admin panel shows none of this yet; decision 6 puts it out of scope.
