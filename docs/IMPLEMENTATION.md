# Onboarding Orchestrator — What Is Actually Built

**Status:** describes `main` at `c386315` (2026-10-12), where the KYC connector kernel, the
`veriff_kyc` provider (§4) and runtime connector selection
([0038](decisions/0038-runtime-connector-selection.md)) have landed, plus `feat/workfow-cleanup` on
top of it: each fixture ships once as `custom` steps (§2 `fixtures/`) and the fixtures site gives
every workflow file one page (§13). Bump this when that work lands. Typed steps as the only authored
form (§2.1, [0011](decisions/0011-typed-steps-are-the-authored-form.md)) has landed.
**Purpose:** this document, not `SPEC.md`, is the baseline for continued development.

`specifications/onboarding-orchestrator/SPEC.md` (v2.6) was the design input — `specifications/` is
gitignored, so that file is a local planning artifact and is not present in a fresh clone. The build
diverged from it deliberately and substantially, so the spec does not describe this system and is not
a reliable guide to it. This document describes the system as it exists, and the reasoning behind the
shape it actually has.

---

## 0. Keeping this document true — read before editing it

**This file describes only what exists in the codebase.** It is the as-built specification, and its
single value is that a reader can trust every sentence to be checkable against the code right now.

**If you add, change, or remove a feature, update this document in the same change.** That is not
optional cleanup for later — a merged feature that is not described here has silently made the
document wrong, and the next person cannot tell which other parts are also stale.

What to update, by the kind of change you made:

| Change                                                             | Update                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------ |
| New or changed endpoint                                            | §11 route table, and the owning section (§3, §5, §6, §7, §8) |
| New workflow DDL construct, field type, format, or validation rule | §2, including the load-time invariant list                   |
| New connector adapter                                              | the adapter table in §4                                      |
| New table, column, or migration                                    | §9                                                           |
| New environment variable or config rule                            | §10                                                          |
| New engine error class                                             | the code/status table in §11                                 |
| New admin-panel error code or detail reader                        | the failure paragraph in §12                                 |
| New package, script, CI step, or compose service                   | §1 package table, §13                                        |

Rules for what goes in:

1. **Describe the present tense only.** No roadmaps, no "next steps", no "we plan to", no
   in-flight branches. If it is not merged and in the codebase, it does not belong here. A feature
   behind a disabled flag is described as what it is: present, and off by default.
2. **Verify before you write.** Every claim must be checkable by reading a named file. Do not carry
   a statement forward from an earlier revision of this document without re-checking it — several
   corrections have already come from claims that were true when written and later drifted.
3. **Keep the reasoning.** Each section explains _why_ a mechanism is shaped the way it is. A new
   section without that is half-written; state the reasoning, not just the mechanism.
4. **Record absences honestly.** If something is unbuilt, unreachable, or a known rough edge, say
   so plainly in the section that covers it — and delete that note once it stops being true.
5. **Update the status line** at the top of this file to the commit you verified against.

---

## 1. The shape of the thing

The engine is a NestJS service that runs **declarative JSON workflows**. An onboarding is a row
holding `(workflowId, workflowVersion, status, currentStep, context)`. A client advances it by
POSTing data to one endpoint; the engine validates the data against the current step's field
declarations, runs that step's connector chain, picks a transition, and commits the new state.
Everything else — outbound webhooks, audit records, document uploads, provider callbacks — hangs
off that single loop.

```
POST /v1/onboardings                    → create row, status/step from workflow.initial
GET  /v1/onboardings/:id/state          → descriptor of the step the client must render now
POST /v1/onboardings/:id/submit         → validate → connectors → transition → commit  ← the only advancing call
POST /v1/onboardings/:id/review/:action → operator-driven transition (approve|reject|invalid)
POST /v1/webhooks/:providerKey/callback → provider resumes a parked async connector, then submits
```

Three design commitments run through the whole codebase and explain most of the local decisions:

1. **Integration is configuration, not code.** New providers, new field types, new text formats,
   new HTTP-based integrations are all declarations. `http_request` and the two DDL registries are
   the concrete expressions of this.
2. **A single homogeneous step shape.** The runtime knows one kind of step. A compiled step has
   data, connectors and transitions; any of them may be empty. Async waiting, manual review and
   terminal states are all the same shape with different content. **Step types** exist one layer
   up, in the authored form, and compile to this shape before anything validates them (§2.1) — so
   the commitment holds where it pays off, in the engine's advance loop, without authors paying for
   it in repetition.
3. **Fail at startup, not at a user's request.** Workflow JSON, connector declarations, HTTP
   connector secret references, callback-auth declarations and config are all validated at boot.
   A misconfiguration takes the process down rather than surfacing as a 500 on someone's
   onboarding.

### Packages

| Package                                          | State                  | Role                                                                                                                                                                                               |
| ------------------------------------------------ | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` (`@tsh/engine`)                | **Substantive**        | The orchestrator. All business logic.                                                                                                                                                              |
| `packages/shared/ddl-schema` (`@tsh/ddl-schema`) | **Substantive**        | The workflow contract: JSON Schema, normalizer, validators, field-type and format registries. Framework-free, consumed by the engine.                                                              |
| `packages/admin-panel` (`@tsh/admin-panel`)      | **Working slice**      | React 19 + Vite operator UI: onboarding list, audit log, and a Connectors section that writes settings. Talks to the engine directly.                                                              |
| `packages/demo-bff`                              | **Empty placeholder**  | Name/version only. No source.                                                                                                                                                                      |
| `packages/demo-web`                              | **Skeleton**           | A Playwright config and one placeholder spec. No app.                                                                                                                                              |
| `packages/docs` (`@tsh/docs`)                    | **Substantive**        | The documentation site: Docusaurus 3 with the TSH theme; hand-written guides, an API reference generated from the OpenAPI document and a fixtures gallery generated from the workflow files (§13). |
| `packages/shared/openapi` (`@tsh/openapi`)       | **Generated artefact** | `engine.openapi.json`, the engine's OpenAPI 3.1 document, written by `pnpm openapi:generate` and held equal to the code by a unit test (§11). No source of its own.                                |
| `packages/skill-evals` (`@tsh/skill-evals`)      | **Substantive**        | Golden-set evaluation of the skills under `.claude/skills/`: runs each case through headless Claude Code, grades the sandbox with the DDL oracles and a Claude judge, writes a report (§13).       |
| `packages/shared`                                | **Empty placeholder**  | Placeholder exports.                                                                                                                                                                               |

The split between `engine` and `ddl-schema` matters: the DDL package has no Nest dependency and no
HTTP concerns, so the workflow contract can be consumed by a future BFF, admin UI, or a workflow
authoring tool without dragging the engine in.

---

## 2. The DDL (workflow definition language)

Canonical types: `packages/shared/ddl-schema/src/workflow-contract.ts`.
Reference docs: `packages/engine/docs/step-data-validation.md`,
`packages/shared/ddl-schema/docs/extending-field-types.md`.

The DDL has one authored form and one runtime form. A document is **written as typed steps**
(§2.1) and nothing else; it **compiles to the compiled form below**, which is what every step type
produces, what the compiled schema and the structural rules validate, and what the engine runs. A
document still written as untyped steps — this compiled shape, with no `type` on a step — is
refused with `INVALID_SHAPE` at the first such step
([0011](decisions/0011-typed-steps-are-the-authored-form.md)). The rules in the rest of this
section are stated over the compiled form and therefore hold for every authored document: a
`custom` step carries exactly one of these compiled steps as its config, and every other step type
produces one or more of them.

```jsonc
// The compiled form — what typed steps become, never what an author writes.
{
  "id": "base",
  "version": 1,
  "initial": "collect_email", // optional; defaults to the first step
  "webhook": { "notify": { "path": "notify" } }, // optional outbound notification target
  "scoring": { "risk": { "min": 0, "max": 100 } }, // optional named scores, integer bounds, min < max
  // optional; the agreement families this workflow collects acceptance for, by family key only
  "agreements": [
    { "key": "eu-b2c-terms", "step": "collect_email", "acceptedWhen": "termsAccepted" },
  ],
  "steps": [
    {
      "name": "collect_email",
      "status": "awaiting_user", // the onboarding status while this step is active
      "data": {
        "email": { "type": "text", "required": true, "validation": { "format": "email" } },
        "termsAccepted": { "type": "boolean", "required": true },
      },
      "connectors": [
        {
          "name": "mock_kyc_1",
          "id": "mock_kyc_1", // the adapter this step calls
          "type": "kyc", // what that adapter does, from CONNECTOR_TYPES
          "order": 1,
          "fieldMapping": { "email": "email" },
        },
      ],
      "scoring": [
        // every rule whose `when` holds contributes; a rule with no `when` always contributes
        { "score": "risk", "when": { "field": "email", "in": ["blocked@example.com"] }, "add": 40 },
      ],
      "transitions": [
        // a score leaf is legal only here, in a transition's `when` — never a field's or a rule's
        { "status": "success", "when": { "score": "risk", "gte": 40 }, "target": "manual_review" },
        { "status": "success", "target": "accept_terms", "webhook": { "notify": false } },
      ],
    },
    { "name": "approved", "status": "approved", "data": {}, "transitions": [] },
  ],
}
```

### Statuses and triggers

`WORKFLOW_STATUSES` = `awaiting_user | awaiting_manual_review | approved | rejected | invalid`.

The status is **declared per step** and the onboarding's status is whatever the active step
declares.

Terminality follows from the status, not from the transition list: `terminal` is set to
`isTerminalStatus(step.status)`, true for `approved`, `rejected` and `invalid`. A terminal step
must then declare empty `data` and empty `transitions` (`INVALID_TERMINAL_STEP`), and a
non-terminal step must declare at least one transition. Entering a terminal step sets
`currentStep = null` and `completedAt = now`, and its declared status is the onboarding's final
status.

Transition triggers are `success`, `rejected`, and the three manual ones `manual.approve`,
`manual.reject`, `manual.invalid`. A transition without a `target` is
**recursive** — the step is retained and awaits the next submit.

**Names.** A step, field, score, author-named port or edge key may not be called anything
`Object.prototype` answers to
(`UNSAFE_NAMES`, derived at runtime: `constructor`, `toString`, `__proto__`, …). Several maps are
keyed by these names, and a plain-object lookup by one of them finds the prototype's member instead
of "nothing" — a field called `toString` used to fail with a misleading `DUPLICATE_FIELD_NAME`. The
schema's `safeName` definition refuses them everywhere a document invents a name.

Within one status group, a conditional arm may be followed by **at most one** unconditional arm,
which must come last, and a status may not be declared twice unconditionally. The fallback is
optional: a group whose conditions are exhaustive can name them all and omit it, which is what
`select_document_type` in `eu-b2c-individual-kyc-eea` does — `documentType` is a closed enum, so an
"everything else" arm would only serve to silently absorb a third type added later. The cost is that
a submit matching no arm resolves to no transition and the onboarding ends `invalid`; declaring the
fallback is how a document opts out of that.

A `rejected` transition may narrow itself to named refusals with `reason`, drawn from
`CONNECTOR_REJECTION_REASONS` = `ATTEMPTS_EXHAUSTED | CHALLENGE_EXPIRED | CHALLENGE_NOT_FOUND |
CONNECTOR_REJECTED`:

```json
{ "status": "rejected", "reason": ["CHALLENGE_EXPIRED"], "target": "resend_phone_code" },
{ "status": "rejected", "target": "rejected" }
```

The routing rule follows from what the reasons mean. An unqualified `rejected` arm is a refusal
and must still land on a terminal `rejected` step (or self-loop, when no connector on the step
declares `canReject`), and at least one such arm is mandatory — so no refusal can go unhandled. An
arm that names its reasons is exempt and may target **any** step, which is what lets a workflow
recover from a challenge that merely went stale instead of refusing the customer for it. Reason
filters bind like `when`: they are conditional arms, so they precede the one unconditional arm in
their status group, and `Step.resolveTransition` takes the reason alongside the trigger.

_Reasoning:_ before this, an OTP connector's `CHALLENGE_EXPIRED` for a code that arrived
two minutes late ended the onboarding, because every `rejected` arm was forced onto a terminal
step. The alternative — dropping that constraint — would let a document swallow a compliance
refusal silently. Naming the recoverable reasons keeps the guarantee and makes the recovery
explicit in the document.

_Reasoning:_ the spec's twelve-value status enum mixed durable states with engine-transient ones
(`awaiting_webhook_ack`, `awaiting_provider_callback`). Collapsing to five values that are all
workflow-declarable means the status column has exactly one writer — the active step — and no
engine state leaks into a value clients branch on. Async waiting is expressed by _staying on the
step_, which needs no status of its own.

### Connector types

`CONNECTOR_TYPES` = `kyc | kyb | aml | credit | otp_verification |
email_delivery | sms_delivery | bank_verification | payment | e_signature | document_storage |
custom`.

A step's connector declaration names two things. `id` is the adapter it invokes — `twilio_sms_otp`,
`smtp` — matched against `ConnectorAdapter.id`. `type` is what that adapter **does**, from the set
above, so `sendgrid_email` and `smtp` are both `email_delivery` and adding a provider joins an
existing value rather than adding one. One-time codes are a single capability,
`otp_verification`, whatever provider or channel carries them: `twilio_sms_otp` and
`smtp_email_otp` both extend `BaseOtpConnector` (§4, "The OTP connectors"), and the channel is a
property of each, not a connector type of its own.

The set is capability-only on purpose. A market segment (B2C against B2B) is a property of the
onboarding, not of the connector — the same identity check serves both — so it is not a value here.
`custom` covers a connector with no capability of its own, which is what makes the generic
`http_request` connector expressible at all.

**The workflow root has no `type`.** A workflow is classified by the connectors it calls, and a
workflow like `manual-review` calls none, so there is nothing it could honestly declare. Declaring
one at the root would also be a second copy of a value the step already carries.

`type` is redundant with the adapter's own declaration, and redundant data drifts, so it is checked:
`WorkflowConnectorExecutorService.validateDeclarations` throws `ConnectorTypeMismatchError` at
startup when a declaration's `type` disagrees with the registered adapter's. The adapter is the
authority; the workflow document is refused rather than left misreporting what it calls.

_Reasoning:_ operators need to group connectors by what they do, and a closed enum keeps that
grouping stable as providers come and go. Declaring it on the workflow too means a document
classifies itself without a registry lookup — worth the redundancy only because the mismatch is a
startup failure rather than a silent disagreement.

**Runtime selection.** An operator can change which adapter a step's connector slot runs without
publishing a version ([0038](decisions/0038-runtime-connector-selection.md), scope per
[0042](decisions/0042-connector-selection-per-version.md)). A selection is one row per workflow
version and step (`workflow_connector_selections`, §9); `Workflow` applies it by replacing the `id`
of the step's primary connector — config, field mapping, retry and error handler stay as authored —
in the version the row names, so execution, callback resolution and the admin projection see the
same effective binding (`workflows/domain/connector-selection.ts`). It applies only to a step with
exactly one connector declaration, and never to a fallback. `WorkflowRegistryService.toWorkflow`
reads the resolved version's rows on every resolution — no cache, so a selection takes effect on the
next request on every instance — and passes none for a `draft`, so a draft, and a version just
published from one, runs its authored connector. A `retired` version keeps its rows and projects
them, though resolution still refuses to run it. The compile dry run
(`POST /v1/admin/workflows/compile`) ignores selections. Choosing the authored id stores a row too,
a pin on that version; only `DELETE` clears it.

**One set of rules for the read and the write.** `ConnectorSelectionRules`
(`workflows/domain/connector-selection.ts`), built by
`WorkflowRegistryService.createConnectorSelectionRules()` from the execution port and the active
scopes, is the only statement of which adapter may serve a slot. `refuse(step, connectorId)` answers
the first failing rule from the table below, or nothing; `listSelectableIds(step, authoredId,
effectiveId)` is the admin projection's `selectableIds`: the authored and effective ids plus every
selectable adapter `refuse` lets through, judged against the step as authored and sorted. So an id
the panel offers is an id a save accepts, with one asymmetry: the projection is per version, while
the write runs the rules across the targeted versions. A step with no connector or more than one
projects `[]`, a fallback's id is never listed, and a candidate whose `validateDeclaration` throws is
left out rather than failing the read. Without a port — the compile dry run, a unit test — the list
is the authored and effective ids alone.

Saving runs `refuse` against **the targeted versions only**, never a draft, in ascending version
order, and the first refusal names its version (`WORKFLOW_CONNECTOR_SELECTION_INVALID`, §11); nothing
is written unless every target accepts (the targets are below the table). The reasons:

| Reason                    | Refused when                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| `no_connector`            | The step declares no connector                                                                         |
| `multiple_connectors`     | The step declares more than one, so a step name cannot name the slot                                   |
| `in_fallback_chain`       | The id is already a fallback on the step                                                               |
| `adapter_not_registered`  | No adapter with the id is registered                                                                   |
| `fixture_not_allowed`     | The adapter is in the `fixtures` scope and `NODE_ENV=production`                                       |
| `type_mismatch`           | The adapter's `type` differs from the declaration's                                                    |
| `async_unsupported`       | The slot is `async: true` and the adapter does not support a callback                                  |
| `callback_fields_missing` | The step does not declare every field in the adapter's `callbackFields` (below)                        |
| `declaration_invalid`     | The adapter's `validateDeclaration` throws for the declaration with the id replaced; the message rides |

**Which versions a write targets.** `scope` is required on both writes (`400 VALIDATION_ERROR`
otherwise). `version` targets that published version: a missing one is `404 WORKFLOW_NOT_FOUND`, a
`draft` `409 WORKFLOW_VERSION_NOT_PUBLISHED`, a `retired` one `410 WORKFLOW_RETIRED`, and one without
the step `404 WORKFLOW_STEP_NOT_FOUND`. `all` targets the covered set: every non-retired published
version whose step of that name has exactly one connector. When none declares the step the answer is
`404 WORKFLOW_STEP_NOT_FOUND`; when some do but none qualifies, the rules' `multiple_connectors` (or
`no_connector`) names the highest of them. The write takes the advisory lock
`${workflowId}:${stepName}`, per family and step, and upserts one row per target in one transaction.
`DELETE` resolves targets the same way and keeps rows on retired versions.

**The projection per version.** `selected` and `id` on a step's primary connector describe the
viewed version only: for a `draft`, `selected` is `false` and `id` equals `authoredId`. The connector
also carries `versions: [{ version, id, authoredId, selected }]`, ascending: the covered set, plus
the viewed version when it is a draft or retired. It is `[]` for a step a selection cannot address
and in the compile response. `WorkflowRegistryService.describeForAdmin` builds it from one
`findRevisions` and one `findByWorkflowId`, and `Workflow.describeDefinition` copies it in.

**The callback-fields guard.** An asynchronous adapter lists the `submittedData` keys its callback
may emit in `ConnectorAdapter.callbackFields`, and a step bound to it must declare every one in
`data`, or a verdict carrying one would be refused when it arrived. `normalizeDefinition` runs the
check for every async connector of a step, fallbacks included, so a hand-written step missing a field
fails the boot as a `WorkflowConnectorDeclarationInvalidError`; the selection service runs the same
check per targeted version (`callback_fields_missing`). It is what keeps the stored Sumsub revision 1, which
does not declare `kycAttemptCount`, from being switched to Veriff and losing a retry verdict; a typed
KYC step always passes.

The same list guards the other direction. The step declares a callback field as ordinary `data`,
so a client could post it: `kycOutcome: 'verified'` would be overwritten by the verdict the park
waits on, but `kycAttemptCount: 0` on the resubmission after each retry would reset the cap and buy
the applicant unlimited provider sessions. `Workflow.evaluate` therefore refuses a client submit
(`continuation` absent) that carries any key an async candidate of the step's slots — fallbacks
included — lists in `callbackFields`: `400 INVALID_STEP_DATA` with `{field: ['CALLBACK_ONLY']}`,
before any connector runs. The continuation — the provider's callback and the operator reconcile,
applied through the same submit path — carries them freely. `GET …/state` still lists the fields in
`step.schema`, since they are the step's; a client should not send them.

**The shipped Veriff family carries Sumsub's keys.** A selection keeps the authored `config`, and
`sumsub_kyc`'s `validateDeclaration` requires `levelName` and `questionnaireDefinitionId`, so both
revisions of `eu-b2c-individual-kyc-eea-veriff` (and the `users/` mirrors) declare them — inert for
Veriff, which ignores every `providerConfig` key — and the family can be switched to Sumsub and
back. `checked-in-workflows.spec.ts` parses every shipped `veriff_kyc` declaration with
`parseSumsubConfig` so the keys cannot be dropped silently. The intended follow-up is letting the
operator edit connector config on a switch; until then, keys the new provider ignores may remain.

Fixture adapters are left out of the selectable ids and refused in production, as fixture workflows
are not loaded there. A row naming an adapter this build does not register logs a warning per row at
boot and fails loudly when the step executes; it never falls back to the authored provider.

### Fields

Root types: `boolean`, `number`, `text`, `date`, `file`, `object`, `array`. `string` is a legacy
alias normalized to `text`. Validation is strict: unknown root fields and unknown nested object
properties are rejected, and values are never coerced (Ajv strict mode).

Two field-level modifiers carry most of the runtime behaviour:

- **`persist`** (root-only, default `true`). `persist: false` values are validated and forwarded to
  connectors and to conditional-transition evaluation, but never written to the onboarding context.
  This is how OTP codes, secrets and other one-shot values move through a step without landing in
  the database. The implementation keeps two projections of a submit: `connectorData` (everything
  active and validated) and `acceptedData` (`connectorData` minus `persist: false`).
- **`when`** — a small boolean condition (`all` / `any` / `not` / `{field, equals}` /
  `{field, in}` / `{field, isSet}`) evaluated against persisted context plus already-accepted
  fields of the same submit. An inactive field must be absent from the submit; sending it is an
  `UNKNOWN` error. Field order is topologically sorted by `when` dependencies
  (`Step.resolveFieldOrder`) so a condition can reference a field submitted in the same request.

_Reasoning for `when` over the spec's JSONLogic dialect:_ the spec proposed a ~20-operator
expression DSL with date helpers. The implemented condition language is a closed algebraic type,
which means it is (a) representable in the JSON Schema, so bad conditions fail at load; (b)
statically analysable — `collectConditionReferences` is what powers both dependency ordering and
the `dependsOn` hint the `/state` endpoint gives the client; (c) safe by construction, with no
evaluator to audit. The cost is that arithmetic and cross-field comparison are not expressible;
that has not yet been needed, and the escape hatch is a connector.

`file` fields are special-cased: `required` must be `true`, `validation.contentTypes` and
`validation.maxSizeBytes` are mandatory, and at most one per step. They are not submitted inline —
see §7.

`date` fields accept `minAgeYears` / `maxAgeYears` alongside `oneOf` / `manyOf`: bounds on the whole
years between the submitted date and the day it is submitted, both read in UTC. They exist because
an eligibility rule such as "at least 18" has no correct absolute spelling — a checked-in cut-off
date is right on the day it is written and wrong the next. A future date yields a negative age and
so fails any minimum.

Because the bound moves with the calendar, two things follow. The keyword is a runtime `validate`
function, never codegen with an inlined constant: `Step` caches compiled validators for the life of
the process, so the bound is resolved per submission. And `oneOf` literals are deliberately **not**
checked against it at load time — a workflow that validated today and stopped validating tomorrow
would be unusable.

The keyword reaches Ajv through the field-type registry rather than the validator: a type declares
`dataKeywords` on the port and `createStepDataValidator` mounts them, so a constraint stock JSON
Schema cannot express stays owned by the type that needs it, and a mounted external type can carry
one too.

### Scoring

A workflow may declare named numeric scores at its root — `scoring: { <name>: { min, max } }` —
and adjust them from step data as the onboarding progresses. `min` and `max` are integers with
`min < max`, checked at load time (`INVALID_VALUE`); a document declaring no `scoring` has no
scores, and every consumer reads `{}` rather than a missing key.

A step contributes to those scores with its own `scoring: [{ score, when?, add }]`, where `score`
must name a root-declared score and `add` is a non-zero integer. A rule's `when` is an ordinary
field condition, evaluated the same way a field's own `when` is. Every rule whose `when` holds
contributes; a rule with no `when` always contributes. The step's matching `add` values are summed
and the result is clamped to `[min, max]` **once**, after every rule on the step has been summed —
not after each individual `add` — so two rules in either order produce the same score. An onboarding
starts with every declared score at its `min`.

The score condition leaf — `{ score: <name>, gte | gt | lte | lt: <n> }`, composing inside
`all` / `any` / `not` like any other condition — is legal **only** inside a transition's `when`.
A field's `when` and a scoring rule's own `when` may not contain one: the JSON Schema routes a
transition's `when` through a separate `transitionCondition` definition family (`transitionCondition`,
`transitionConditionAll/Any/Not`, `conditionScoreComparison`) that a field's and a rule's `when` do
not reach, and the normalizer enforces the same restriction independently — a score leaf is normalized
only while a `declaredScores` set is present in `ConditionNormalizationContext`, which is set solely
while normalizing a transition. _Reasoning:_ `GET /v1/onboardings/:id/state` publishes each field's
`when` so a client can re-resolve visibility as the form fills; a field gated on a score the client
cannot compute would either break that contract or force the engine to publish live scores to the
end user. Transition resolution is server-side only, so the leaf costs nothing there. There is no
`equals` comparator on a score, and no `in` / `isSet`: a score is the result of accumulated
arithmetic, so banding is what a document actually wants, and exact equality on a computed integer
is a trap rather than a feature.

### Agreements

A workflow declares the agreement families it collects acceptance for at its root, beside `steps`:

```jsonc
"agreements": [{ "key": "eu-b2c-terms", "step": "accept_terms", "acceptedWhen": "termsAccepted" }]
```

A declaration names the **family** and where its acceptance is observed. `key` is the family
identifier — matching `^[a-z0-9][a-z0-9-]*$` and declared once per document — `step` names the step
whose submit collects the acceptance, and `acceptedWhen` names that step's own persisted boolean
field whose `true` marks the family accepted. There is deliberately no version here: which version
an onboarding owes is the engine's to resolve, so a version written into a document would go stale
on the next publish. The array, when present, must hold at least one entry.

It is a root member in both forms, authored and compiled, the same place the `scoring` score
declarations sit — a family is a property of the workflow, not of the screen that happens to carry
its checkbox, and reading one list answers what a workflow collects without walking its steps. The
compiler rewrites `step` to that step's compiled **entry** step, which is where the author's own
fields — and so `acceptedWhen`'s target — land.

Everything else about the family lives in the database, not the DDL. The versions themselves are
rows in `agreements` (§9), published through `POST /v1/admin/agreements` (§11); the links an
onboarding holds against them are rows in `onboarding_agreements`; and the whole-onboarding
`current` / `outdated` / `not_accepted` label is derived by a view, never stored. Decision record
[0013](decisions/0013-versioned-agreements.md) records the reasoning.

At runtime the declaration drives three things:

- **Start.** `OnboardingsService.start` collects every declared key
  (`Workflow.getDeclaredAgreementKeys`), resolves each to the family's highest published
  version, and writes a `pending` link per family inside the transaction that creates the
  onboarding. A declared key with no published version is an operator's configuration gap rather
  than a user error, so the start fails with `503 AGREEMENT_NOT_PUBLISHED` and no onboarding is
  created — the same reading, and the same status, as `CONNECTOR_NOT_CONFIGURED`.
- **Submit.** After a successful transition, every declaration bound to the applied step
  (`Workflow.findStepAgreements`) whose `acceptedWhen` field reads `true` in the post-transition
  context is recorded as accepted, in the
  same transaction as the state write. The version recorded is the family's **latest published**
  one, resolved at acceptance time — see the trade-off in `0010`.
- **Nothing else.** A declaration does not gate the step, block a transition, or reach the
  `/state` descriptor. An onboarding owing a new version still progresses.

_Reasoning:_ the field this replaces was a hardcoded `termsVersion` text field the workflow author
maintained by hand, which meant publishing a new version was a workflow-document edit and nothing
recorded which version an existing onboarding had accepted. Naming only the family moves the
version to the one place that can answer that question.

The admin panel has no surface for any of this yet — publishing, listing and the derived status are
engine API only.

### Two registries instead of a checked-in schema

`ddl-schema` derives the workflow JSON Schema **in memory** from a field-type registry and a text-
format registry (`src/fields/field-type.registry.ts`, `src/formats/field-format.registry.ts`).
There is no generated schema file to keep in sync. A new field type is one module plus one array
entry; the schema, the validators, the step-data schemas and the `WorkflowFieldType` union all
follow. Types can also be **mounted at runtime** via `registerFieldType` / `registerFieldFormat`
before the first workflow is validated — the compiled Ajv validator is keyed to a registry version
and invalidated on registration.

_Reasoning:_ a checked-in `onboarding-workflow.schema.json` (as the spec required) is a second
source of truth that drifts. Deriving it removes the drift and makes "add a field type" a
genuinely closed change. `src/fields/field-type-extension.spec.ts` and
`field-type-mounting.spec.ts` exist specifically to prove that no core file needs editing.

### 2.1 Step types: the authored form

Canonical types: `packages/shared/ddl-schema/src/workflow-contract.ts` (`RawWorkflowDefinition`,
`RawWorkflowStep`, and the `CompiledWorkflow*` intermediate), `step-types/step-type.port.ts`.
Decision records: [0009](decisions/0009-workflow-node-types.md) for the layer,
[0011](decisions/0011-typed-steps-are-the-authored-form.md) for the vocabulary.

A document declares `steps`, each naming a **step type**; it is the only form the DDL accepts.
`validateAndNormalizeWorkflow` routes every document through `compileWorkflow` and validates the
resulting compiled document against the compiled schema and the rules of §2 — one runtime contract,
one set of structural rules, and no way for what an author writes and what the engine runs to
disagree. The engine learns nothing about step types. A document written as untyped steps — the
compiled shape, authored directly, as every workflow once was — is rewritten by
`convertUntypedSteps` (`pnpm workflow:compile <file> --from-untyped` prints the result), one
`custom` step per step, and compiles back to exactly the steps it was.

```jsonc
{
  "id": "example",
  "version": 1,
  "initial": "who", // names a step; defaults to the first
  "steps": [
    {
      "name": "who",
      "type": "identity-profile", // the step type; see the registry below
      "config": { "nationalities": "eea", "minAgeYears": 18 },
      "include": [{ "type": "address", "config": { "countries": "eea" } }], // fragments merged into this step's compiled step
      "substeps": { "verify": "verify_phone_code" }, // renames a generated sub-step
      "scoring": [{ "score": "risk", "when": { "field": "country", "in": ["RU"] }, "add": 40 }], // rules, on the compiled step this type names for them
      "edges": { "success": [{ "target": "done", "webhook": { "notify": false } }] }, // target *step* per output port; an arm may opt out of the client notification
    },
    { "name": "done", "type": "terminal", "config": { "outcome": "approved" } },
  ],
}
```

**One authored step, one or more compiled steps.** Most types compile to exactly one compiled step,
named after the authored one; `otp-verify` and a two-sided `document-capture` compile to several.
"Step" in this section means the authored one unless it says "compiled".

**Ports, not conditions.** A step type declares named output ports and an author wires one edge
per port. An edge names a _step_; the compiler resolves it to that step's **entry step** — the first
compiled step it produces — so an author never needs to know which of a compound step's compiled
steps comes first. An unwired non-optional port fails the document with `INVALID_TRANSITIONS`, and
an edge naming a port the type does not expose fails the same way — this is the check that makes a
canvas safe.

**Sub-steps and naming.** A step type declares the sub-steps it compiles to as keys: `null` means
the step's own name, and any other key becomes `<step>_<key>` unless `substeps` renames it. So
`otp-verify` named `send_phone_code` yields `send_phone_code`, `send_phone_code_verify` and
`send_phone_code_resend`, and a two-sided `document-capture` named `capture_id_card` yields
`capture_id_card_front` and `capture_id_card_back`. Compiled step names are client-visible — a
client renders per step — which is why the rename exists: revision 2 of the built-in workflow
renames those two to revision 1's `verify_phone_code` and `resend_phone_code`, so no caller has to
change.

**`include`.** Any step may merge field fragments into its own entry step. Only a type marked
`composable` may appear there (`form`, `contact-details`, `consents`, `identity-profile`,
`address`, `questionnaire`): one compiled step, no connectors, no ports, so there is no control
flow to lose when it is merged. Merge order is the step type's own fields first, then each fragment
in declared order — and that is insertion order in the compiled `data`, so the composition an
author writes is the form the applicant sees.

**Two-phase compilation over a document contract.** Every step may `publish` canonical field roles
(`firstName`, `country`, …), captured documents, offered document options and questionnaire items.
All publications are assembled _before_ any step compiles and handed to all of them. That is what
lets `kyc-identity-verification` derive its whole connector declaration — the applicant field
mapping from canonical roles, the `documents[]` table from the capture steps joined to the choice
step on document type, and `questionnairePathMap` from the questionnaire step's sections. Two steps
claiming one canonical role is `DUPLICATE_FIELD_NAME`; a `kyc` step whose document collects none of
the applicant attributes it needs is `INVALID_VALUE`, at load.

The contract a step sees is **scoped to its ancestors** — the steps with a path to it, plus itself —
not to the whole document. A `document-capture` placed after the check therefore never leaks into
the check's upload table as an optional document that will always be absent. Ancestry follows
edges; a retry that loops back makes the looped-to steps ancestors, which is right — they did run
first, on that path.

**Ports are opaque to step types.** `context.targets[port]` is a token, never a compiled step name.
After a step compiles, the compiler replaces each token with the destination the author wired, and
fails a type that wrote a token it was not given or ignored a port that was wired. That indirection
is what makes **conditional edges** free for every type: an edge may be a step name or an ordered
list of arms `[{ when?, target }]`, with at most one arm lacking a `when` and it last — the compiled
form's own rule. One transition fans out into one arm per condition, the step's own `when` conjoined
under `all` with the arm's. `document-choice` routing a passport to a fast or slow capture by a
`vip` flag is the worked case in `workflow-features.spec.ts`.

**Step-level `scoring`.** Any step may carry `scoring: [{ score, when?, add }]` — the compiled
form's own rule shape — and the compiler attaches the rules to the compiled step whose submit
decides the step's outcome: the entry step, unless the type says otherwise through
`resolveScoringStepKey` (`otp-verify` scores on the check, where the code is known to be right).
`terminal` has no submit and `risk-score` carries its rules in config, so both refuse the list with
`INVALID_VALUE` at `steps[i].scoring`. Routing on the result needs no `risk-score` step: a
conditional edge's `when` may carry a score leaf like any transition's.

**Edge `webhook`.** An arm may carry `webhook: { notify: false }`, the compiled form's
per-transition opt-out of the outbound client notification (§6), which the compiler copies onto the
transition the arm becomes. It is the one place a notification opt-out can be written, because
whether a move is worth telling the client about is a property of the edge, not of the step.

**`meta`.** A free-form object on the root and on any step, carried and never read. The stored
document is the authored one, so it is the only place a builder can keep a title, a description or
a canvas position.

**Failures say where.** `WorkflowInvalidError` carries an optional `path` —
`steps[3].config.documents[1]`, `steps[0].edges.success` — into the authored document. It is a
separate property, never folded into `message`: the message is the stable code a caller compares,
and a path names things from the document, which the message must not leak. The compiler wraps each
step's parse, include, edge and compile phases so the innermost location wins. Every member an
author can write — a `custom` step's or `connector-call`'s connectors and transitions included — is
validated against the compiled schema's own definitions before compilation, so a failure the
compiled schema reports afterwards (`steps[k]…`, indexing compiled steps) can only come from a
type's `compile` and is restated as `steps[i]`, the authored step whose type produced compiled step
`k`. A semantic invariant checked inside one step — its connectors' field mappings, field
conditions, scoring and transitions — is located at that step (`steps[i]`); one spanning steps
carries a reason and no path.

**`compileWorkflowReport`** returns the compiled form _and_ each step's resolved shape — type,
category, the compiled steps it owns (`compiledStepNames`), and per port the arms it leads along, in
authored step names. It is what `POST /v1/admin/workflows/compile` (§11) hands a builder, which
compiles the document for the report and hands the same authored document to the registry for the
checks startup runs.

#### The step-type registry

`src/step-types/step-type.registry.ts`, and the workflow JSON Schema derived from it in memory and
keyed to its version — the same seam, and the same reasoning, as the field-type registry above.
`registerStepType` mounts one at startup.

| Type                        | Category  | Compiles to                                                                                                      |
| --------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------- |
| `form`                      | collect   | One compiled step of hand-written fields. Composable; the field-level escape hatch                               |
| `contact-details`           | collect   | Email and phone number, each required, optional or omitted. Composable                                           |
| `consents`                  | collect   | A pinned version plus its acknowledgement, per consent. Composable                                               |
| `identity-profile`          | collect   | Legal name, date of birth, nationality. Composable                                                               |
| `address`                   | collect   | A postal address; `prefix` allows a second one. Composable                                                       |
| `questionnaire`             | collect   | Preset risk-profiling sections with their option sets. Composable                                                |
| `document-choice`           | collect   | The document type plus a gated issuing country each; one port per document                                       |
| `document-capture`          | collect   | One upload, or two compiled steps for a two-sided document                                                       |
| `selfie-capture`            | collect   | One upload, in the selfie slot rather than the identity one                                                      |
| `otp-verify`                | verify    | Send, check and re-send of a code to the address a collector published                                           |
| `kyc-identity-verification` | verify    | One parked step, seven ports, five callback fields, connector declaration derived from the contract              |
| `decision`                  | decide    | A data-less branch point; one port per condition                                                                 |
| `risk-score`                | decide    | A step's scoring rules, with score-banded ports                                                                  |
| `manual-review`             | decide    | An `awaiting_manual_review` step; approve / reject ports, `invalid` optional                                     |
| `http-call`                 | integrate | An `http_request` connector, field mapping derived from the template                                             |
| `notify`                    | integrate | A delivery connector keyed on the shared `recipient` payload key                                                 |
| `connector-call`            | integrate | Fields plus connectors declared in full, as a compiled step declares them; a `rejected` port when one can refuse |
| `wait-for-external`         | integrate | A collection step another system fills in                                                                        |
| `custom`                    | integrate | A hand-written compiled step, verbatim. No ports; the guarantee typed steps lose nothing                         |
| `terminal`                  | terminal  | `approved` / `rejected` / `invalid`                                                                              |

Presets carry the values authors otherwise repeat: `step-types/presets/country.preset.ts` holds
`eea` (30 states) and `eea-id-card-issuers` (28 — Denmark and Ireland issue no national ID card),
and `step-types/presets/questionnaire.preset.ts` holds the four sections with ISCO-08 occupation
groups and the source-of-funds and monthly-band option sets.

**Connector slots.** A step type that calls a connector declares a `connectorSlot`: the connector
types (§4) it can drive, an optional default id or type, and how much the author may add. The
binding under `config.connector` is checked against it at compile time, so an `otp-verify` bound to
`sumsub_kyc`, or a `kyc-identity-verification` bound to a delivery connector, fails the document
with `INVALID_VALUE` at `steps[i].config.connector` rather than a type-mismatch at runtime.
`otp-verify` accepts `otp_verification` only, and its `channel` (`sms` or `email`) is carried to the
adapter as derived config; `kyc-identity-verification` accepts `kyc`; `notify` accepts `email_delivery` or
`sms_delivery`; `http-call` accepts `custom` and defaults to `http_request`. The slot's `extras`
says what else the binding may carry: `otp-verify` lets the author add `fieldMapping` keys beside
the `recipient` and `code` it derives (it has no `config` extras: the `operation` and `channel` it
derives are the adapter's whole config), and `kyc-identity-verification` and `notify` let them add
both `fieldMapping` and `config` keys beside what the type derives (for `notify` that is only the
`recipient` key, so the template's payload keys and the adapter's settings all travel on the
binding). An addition that would override a derived key is refused — the derivation is the point of
the type — and `GET /v1/admin/step-types` publishes each type's `connectorTypes` so a builder can
filter the configured connectors before the author picks one.

**The identity-verification step names no provider.** Its config is `connector`, `sourceKey` and
`maxAttemptsPerDocSet`, all required. `levelName` and `questionnaireDefinitionId` are still accepted
at the step level, optional, and they are Sumsub's: stored revisions authored for Sumsub carry them
and a stored revision is immutable. A new document puts a provider's own keys under `connector.config`
instead; the step merges them into the compiled declaration's `config` (a key present both at the
step level and there is refused like any other override of a derived key), and the KYC connector
hands every key no kernel rule consumed to the provider as `providerConfig` (§4). The step declares
five callback fields on its compiled step — `kycOutcome`, `kycRetryStep`, `kycReasonCodes`,
`kycCustomerMessage` and `kycAttemptCount` (an optional `number`, emitted unconditionally). Stored
versions keep the _authored_ JSON, so the added field changes no stored revision; it changes the
compiled form of one, which is why `eu-b2c-revision-equivalence.spec.ts` pins it (below).
`maxAttemptsPerDocSet` keeps its name for the stored revisions' sake and reads two ways: per docSet at
Sumsub, total resubmissions per onboarding at Veriff (§4).

Every binding also carries the compiled form's **failure policy** (§4): `errorHandler`, `retry` and
a `fallback` chain of up to three entries, each naming an `id` of the same capability and, where
the slot allows, its own `fieldMapping` and `config` additions — laid under the same derived keys
the primary has, so an SMTP stand-in can name the template an email API's primary never needed,
while an entry declaring no additions inherits the primary's. Every declaration an `otp-verify`
emits, fallbacks included, carries the derived `config: { operation, channel }` — `operation` is
`send` on the send and re-send steps and `check` on the code-entry step — so a fallback is an
`otp_verification` adapter that reads the same two keys.
The `connector-call` type has no slot at all: its `connectors` are declarations in full, as a
compiled step carries them, which is what makes a mock `kyc` adapter on a collection step
expressible without a `custom` step.

**Collecting contact details and proving them are two steps.** `contact-details` collects `email`
and `phoneNumber` under those canonical names, each `required`, `optional` or `omitted`.
`otp-verify` collects nothing: it sends to the field the canonical role of its channel resolves to
(`phoneNumber` for `sms`, `email` for `email`), which a collector earlier in the
document must have published — or to an explicit `recipientField` — and fails at load if neither
is there. Its second compiled step is the code entry, with the code never persisted.

**Known absences, deliberate.** No `timer` type: nothing in the engine schedules work against a
parked onboarding, so a declared deadline could never fire. No `parallel` / `join`: the advance
loop holds a single `currentStep`. Both need engine work rather than a step type, and
[0009](decisions/0009-workflow-node-types.md) records why.

### Load and validation

`WorkflowFileLoaderService` reads `*.json` directly inside each scope directory — no recursion, no
other formats. Each file is parsed, compiled from its typed steps, validated and normalized by
`validateAndNormalizeWorkflow`; a file still written as untyped steps fails here with
`INVALID_SHAPE` at the first step without a `type`.
`WorkflowRegistryService.onModuleInit` then runs the engine-level checks over every loaded
definition — each adapter's `validateDeclaration`, plus the connector `errorHandler` and `fallback`
rules below — **before** publishing anything into `workflows` (one row per document `id`, stored
as `key`, with the display label `name` and the family's `scope` beside it) and `workflow_versions` beneath it (one row per
revision, `UNIQUE (workflow_id, version)`), and applies the same checks again to every stored
revision it reads back — except `draft` rows, which neither this sweep nor the compile dry run compiles
([0034](decisions/0034-admin-authored-workflow-drafts.md)).
Validating ahead of the publish is what keeps a rejected document out of the tables: an engine-level
mistake such as an `errorHandler` naming a handler that is not registered would otherwise be
persisted by the very startup it then fails, and every later startup would fail on the stored row
even after the file was fixed. Anything wrong — unreadable directory, malformed workflow, unknown
transition target, duplicate step name, two files sharing an `id` **and** `version`, unresolvable
`{{secrets.*}}` reference, invalid `http_request` config, a file whose definition differs from the
revision already stored under its `id` and `version` (`WorkflowVersionConflictError`), a file whose
`id` belongs to a family loaded from or stored under another scope (`WorkflowScopeConflictError`) —
throws during startup. A repeated `id` at a _different_ version in the same scope is legal: that is
how a revision is published; a family belongs to one scope, so a `users/` file can never revise a
built-in or fixture flow — it forks it under an id of its own. **A stored revision is immutable**:
a file identical to its row is a no-op, so restarts
are idempotent, and a changed one has to take a new version — on a development stack whose stored
workflows are disposable, `pnpm stack:reset` discards rows that no longer match their files.

**The tables, not the file set, are the read model.** `getById`, `getByVersionId` and
`resolveForStart` are async and query `workflow_versions` joined to its parent `workflows` row on
every call, then validate, normalize and build a fresh `Workflow`; nothing is cached between
requests. A revision edited, drafted or retired directly in the database — by the admin UI, say —
takes effect on the next request rather than the next deploy, and every engine instance answers
identically. Files only seed: a version is inserted once, as `published`, and never updated, so a
revision moved off `published` in the database is not republished by the next startup. A file whose
`id` and `version` match a stored `draft` is skipped, not inserted and not compared: the engine
starts, the draft row is unchanged, and the skip is logged at error level with the id, the version
and the file, until the draft is deleted or renumbered. Publishing such a draft is refused with
`409 WORKFLOW_VERSION_EXISTS`. The one value files write more than once is
the family's `name`: it follows the highest stored **non-draft** version that declares a root
`name`, so publishing a renamed revision renames the workflow, a revision without one leaves the
label alone, and a stored draft never causes a relabel.

Failures are reported as `WorkflowInvalidError` with one of nine fixed reasons (`INVALID_SHAPE`,
`UNKNOWN_PROPERTY`, `INVALID_VALUE`, `DUPLICATE_STEP_NAME`, `DUPLICATE_FIELD_NAME`,
`DUPLICATE_TRANSITION`, `INVALID_TRANSITIONS`, `UNKNOWN_TARGET`, `INVALID_TERMINAL_STEP`). That
list is treated as a public contract; new field types fail with `INVALID_VALUE` rather than adding
reasons.

The same validator runs outside the engine: `pnpm workflow:validate`
(`scripts/validate-workflows.cjs`) loads `@tsh/ddl-schema`'s built `validateAndNormalizeWorkflow`,
runs it over each scope directory or the paths it is given, and reports the reason a failed startup
would report — plus the loader's own duplicate `(id, version)` check. A bare run resolves the user
scope from `WORKFLOWS_USERS_DIR` exactly as the loader does, and paths that match no file exit `1`
rather than reading as a pass. It carries none of the engine-level checks, which need a running
engine. A reason names at most the offending step, never the declaration
inside it; `.claude/skills/creating-workflows/references/startup-failures.md` maps each one back
to the checks that raise it.

One further startup invariant crosses document boundaries and sits outside that per-document list:
`WorkflowRegistryService.onModuleInit` also sweeps every stored workflow for a repeated connector
`config.sourceKey`, throwing `DuplicateWorkflowSourceKeyError` when two different workflow
documents declare the same value — the same key repeated within one document, across steps or
connectors, is legal and does not trigger it. It is generic over connector id, no adapter is
special-cased, and it exists because `sourceKey` is how an operator names one workflow's
deployment-specific connector configuration (`sumsub_kyc`'s or `veriff_kyc`'s, for two — §4) for correlation outside
the engine; two documents silently sharing one would make that correlation ambiguous. Stored `draft`
rows are left out of that sweep and out of the dry run's uniqueness check, so a draft may share a
`sourceKey` with another workflow; the conflict surfaces when the draft is published, whose compile
answers `409 WORKFLOW_SOURCE_KEY_CONFLICT`.

Beyond the JSON Schema, `validateAndNormalizeWorkflow` enforces a set of semantic invariants over
the compiled form. They hold for every step type's output and are worth knowing before
authoring a workflow, because each one is a startup failure:

**Steps and fields**

- Step names are unique; `initial` defaults to the first step and must name an existing one; the
  initial step may not be terminal.
- **Field names are unique across the entire workflow**, not merely within a step. This is what
  lets a `when` condition and a connector `fieldMapping` name a field with no step qualifier.
- Per-step occurrence limits declared by a field type are enforced generically —
  `maxOccurrencesPerStep: 1` on `file` is the only one in use.

**Conditions**

- A condition object accepts exactly one operator; `all`/`any` need a non-empty array, and
  `equals`/`in` literals must be type-compatible with the referenced field, decided by that field
  type's own `validateConditionLiteral`. Types that cannot be compared at all (`file`, `object`,
  `array`) simply do not implement it, so referencing one fails.
- A field's `when` may not reference itself, directly or through a cycle of other fields'
  conditions (`validateFieldDependencies` does a DFS with a visiting/visited marker).

**Transitions**

- Within one status group an unconditional fallback is **optional**, but a group may carry at most
  one and it must come **last**. Two unconditional transitions of the same status are a
  `DUPLICATE_TRANSITION`; one placed before a conditional arm is `INVALID_TRANSITIONS`. The rule is
  the same for outcome and manual statuses alike. Omitting the fallback is how a group whose
  conditions are exhaustive says so; the cost is that a trigger matching no arm resolves to no
  transition and the onboarding ends `invalid`.
- A manual transition must declare a `target` and may not target its own step.
- `canReject` is a real routing rule, not documentation: if no connector on the step declares
  `canReject`, a `rejected` transition may only self-loop; if one does, the step **must** declare an
  unqualified `rejected` transition and every unqualified one must target a step whose status is
  `rejected`. A `reason`-qualified arm is exempt and may target any step — see below.

**Connectors**

- `order` must be a positive integer, unique within the step; declarations are sorted by it at
  normalization time.
- A connector's `fieldMapping` may only read a field written **in its own step**, or in a step
  that is a _guaranteed predecessor_ — one every path from `initial` must pass through — **and**
  that persists the value. Guaranteed predecessors come from an iterative dominator analysis over
  the step graph (`transitions/step-graph.ts`). This turns "the connector will get its data" from
  a runtime hope into a load-time proof; the runtime
  `ConnectorPayloadFieldNotFoundError` remains only as a backstop.

**Agreements**

- The root `agreements` array, when declared, holds at least one entry; each `key` matches
  `^[a-z0-9][a-z0-9-]*$` and is declared once in the document — a family accepted from two places
  would owe one link with nothing to say which binding settles it.
- `step` must name a step of the workflow; one that does not is `UNKNOWN_TARGET`.
- `acceptedWhen` must name a field declared in **that step's** `data`, whose normalized type is
  `boolean` and which does not carry `persist: false`. The submit path reads the marker back out of
  `onboardings.context`, so a field belonging to another step, of another type, or dropped before
  storage would leave the acceptance unobservable.

**Webhooks**

- The root `notify.path` is validated segment by segment against `[A-Za-z0-9._~-]+`, rejecting
  empty segments, `.` and `..` — so a declared path cannot traverse out of the configured base URL.
- A transition `webhook` may only carry `notify: false`. It has no destination of its own.

### Revision status

Every stored revision carries its own `status`, so one workflow id can hold a published revision
serving traffic, a newer draft, and older discontinued ones at the same time.

| Status      | Unpinned start        | Pinned lookup (an in-flight onboarding)             |
| ----------- | --------------------- | --------------------------------------------------- |
| `published` | Highest one is served | Served                                              |
| `draft`     | Skipped               | Refused with `WORKFLOW_VERSION_NOT_PUBLISHED` (409) |
| `retired`   | Skipped               | Refused with `WORKFLOW_RETIRED` (410)               |

`draft` means "not usable yet" and never runs: `resolveForStart` and `getById` refuse a pinned draft.
`getByVersionId`, which resolves an onboarding already linked to a revision, is unchanged. No HTTP route
pins a version at start today, so the refusal is on no route's contract; registry unit tests prove it.
`retired` means "not usable any more". Retiring is therefore a hard
stop, not a soft one — onboardings already pinned to a retired revision cannot read their state or
submit either, which is the point of the status and the thing to weigh before setting it.

The admin definition read (`GET /v1/admin/workflows/:workflowId/versions/:version`) is the exception: it
serves a `retired` or `draft` revision, so an operator can inspect it. Start, submit and in-flight
resolution still refuse a retired one. `GET /v1/admin/workflows/:workflowId` takes no `version`
parameter and serves the highest `published` revision. A draft that does not compile answers
`400 WORKFLOW_INVALID` (or `400 WORKFLOW_CONNECTOR_DECLARATION_INVALID`) on that read, not a 500.

**Drafts are the one mutable revision** ([0034](decisions/0034-admin-authored-workflow-drafts.md)).
Operators create, replace, delete and publish `draft` rows through the admin API (§11), in `users` scope:

- Saving needs only a JSON object with a string `id` (at most 100 characters) and a positive integer
  `version` no larger than 2147483647, the `integer` column's maximum; the document is stored as authored and never compiled on save. The compile dry run tells
  the author whether it is valid.
- A family holds at most one draft, enforced by the partial unique index
  `uq_workflow_versions_one_draft` (migration `0001_initial_schema`).
- A draft whose `id` names no family creates one; an `id` naming a `built-in` or `fixtures` family is
  `WORKFLOW_SCOPE_CONFLICT`. A `name` of 1–200 characters labels the family only when the call
  creates it.
- An update may change the draft's `id` and `version` when the target is free; a family left with no
  versions is deleted.
- Update and delete are refused while an onboarding references the row (`WORKFLOW_DRAFT_IN_USE`),
  because `fk_onboardings_workflow_version` is `ON DELETE RESTRICT`.
- `GET .../versions/:version/document` returns the stored document verbatim for a version of any
  status, connector `config` included ([0041](decisions/0041-admin-workflow-documents-for-every-status.md)),
  so the route is admin-only; the definition read still omits `config`. An unknown version is
  `404 WORKFLOW_NOT_FOUND`; there is no 409.
- Each write is audited in its own transaction (§8) with identifiers only. Last write wins: there is
  no optimistic lock.

**Publishing** (`POST .../versions/:version/publish`, no body) turns the stored draft into a
`published` revision, which is immutable from then on
([0040](decisions/0040-publishing-admin-authored-drafts.md)). `WorkflowDraftsService.publish` runs one
transaction:

1. `pg_advisory_xact_lock` on the string key `'workflow:publish'` (hashed with `hashtext`), so publishes run one at a time and two families cannot
   both pass the `sourceKey` check; it is taken before the row lock.
2. The draft row is locked: `404 WORKFLOW_NOT_FOUND`, or `409 WORKFLOW_VERSION_NOT_DRAFT` for a
   `published` or `retired` version.
3. A `published` version of the family at or above the draft's answers
   `409 WORKFLOW_VERSION_NOT_LATEST`, carrying `workflowId`, `version` and `latestPublishedVersion`.
4. A workflow file declaring the same `id` and `version` answers `409 WORKFLOW_VERSION_EXISTS`:
   startup skips such a file while the row is a draft, but would compare it with a published row
   and fail the boot when the two differ. The scope directories are read asynchronously and only each
   file's `id` and `version` are compared; a file that does not parse is skipped, left for the next
   boot to refuse, rather than failing the publish. A file that cannot be read fails the publish
   instead, since skipping it could let a shadowed version through.
5. The stored document goes through the compile route's full compile on the transaction's snapshot,
   including the `sourceKey` sweep over non-draft rows: `400 WORKFLOW_INVALID`,
   `400 WORKFLOW_CONNECTOR_DECLARATION_INVALID` or `409 WORKFLOW_SOURCE_KEY_CONFLICT`. The row stays
   a draft.
6. The row flips to `published`. A root `name` of 1–200 characters is written to the family's label
   unless a non-draft version above this one exists.
7. `workflow_draft.published` is audited with `workflowId` and `version` only.

The consequences: unpinned starts are served the new version at once, the family label may change,
and publishing never changes another version's status, so an older `published` version keeps
serving pinned lookups. The family has no draft afterwards, so the next version is an ordinary draft
create. Retiring still has no endpoint; status changes beyond publishing are made directly in the
database.

### Checked-in workflows (`workflows/`)

#### `built-in/` — shipped, loaded in every environment

A built-in family cannot be extended from `users/`: a users file reusing its `id` fails the boot
with `WorkflowScopeConflictError`. The four `users/*-local.workflow.json` files — `eu-b2c-individual-kyc-eea-local`,
`eu-b2c-individual-kyc-eea-v2-local`, `eu-b2c-individual-kyc-eea-veriff-local` and
`eu-b2c-individual-kyc-eea-veriff-v2-local` — are the fork pattern instead: copies under ids of their
own, with renamed `sourceKey`s (and, for the manual-test walkthroughs, a local provisioning stub).

| File                                                | Rev | Authored as                           | Connector types                     | Is                                                                                                |
| --------------------------------------------------- | --- | ------------------------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| `eu-b2c-individual-kyc-eea.workflow.json`           | 1   | `custom` steps, one per compiled step | `otp_verification`, `kyc`, `custom` | The reference EU B2C individual KYC flow; the applicant chooses passport or national ID card      |
| `eu-b2c-individual-kyc-eea-v2.workflow.json`        | 2   | specialized step types                | `otp_verification`, `kyc`, `custom` | The identical flow, authored through the specialized step types (§2.1)                            |
| `eu-b2c-individual-kyc-eea-veriff.workflow.json`    | 1   | `custom` steps, one per compiled step | `otp_verification`, `kyc`, `custom` | The same flow with the KYC step bound to `veriff_kyc` (family `eu-b2c-individual-kyc-eea-veriff`) |
| `eu-b2c-individual-kyc-eea-veriff-v2.workflow.json` | 2   | specialized step types                | `otp_verification`, `kyc`, `custom` | The Veriff family's revision 2, through the specialized step types                                |

Seventeen steps: contact and consents → SMS one-time code (with a resend path) → declared identity →
purpose and source of funds → `select_document_type` → the capture steps for the document chosen →
selfie → `submit_kyc` → manual review → account provisioning → `userId` collection → `approved` /
`rejected` / `invalid`.

**The Veriff family.** `eu-b2c-individual-kyc-eea-veriff` is the Sumsub family under an id, a name and
a `sourceKey` of its own (`eu_b2c_individual_kyc_eea_veriff_v1`), and its two revisions are authored
exactly as the Sumsub ones are. The difference from the Sumsub family is the KYC step's
connector binding: `veriff_kyc` in place of `sumsub_kyc`, without the Sumsub-specific `levelName` and
`questionnaireDefinitionId`. Two others are consequences: the Sumsub revision 1 predates
`kycAttemptCount`, whereas the Veriff revision 1, written after it, declares the field in
`submit_kyc.data` itself, because a provider that does not count attempts writes it; and the identity
document uploads accept `image/png` and `image/jpeg` only (revision 2 narrows `document-capture`'s
default with `contentTypes`), because Veriff takes a PDF only once enabled on the account (§4). Both families
declare the same two agreement families (`eu-b2c-terms`, `eu-b2c-privacy-notice`), the same retry arms
and the same ports. The two `-veriff-local` forks are the fork pattern for it.

**Two revisions, one flow.** Revision 1 is the flow written step by step — seventeen `custom`
steps, each carrying one compiled step verbatim, which is what a document written as untyped steps
converts to. Revision 2 is the same onboarding written as fifteen specialized steps, with one
deliberate difference: collecting the contact details and proving the phone number are separate
steps, so the one-time code is sent by a compiled step of its own, `send_phone_code`, rather than
by the submit that collected the number. Eighteen compiled steps against seventeen, and
`packages/engine/src/workflows/eu-b2c-revision-equivalence.spec.ts` pins exactly that: the
contact step collects the same fields and consents, the send step carries the connector the contact
step used to, and every other step normalizes to the identical definition — the same fields, the
same connector declarations, the same transitions, and the same root `agreements` array bound to
the same step. 951 lines against 277. For the Sumsub pair the spec pins one further difference: the
compiled revision 2's `submit_kyc.data` carries `kycAttemptCount` (`number`, optional, persisted),
which the hand-written revision 1 predates and a stored revision cannot gain. The Veriff pair needs
no such exception, its revision 1 declaring the field. Every invariant in
`eu-b2c-individual-kyc-workflow.spec.ts` runs against both, so the specialized types are held to the
step-by-step document's own rules rather than to a weaker set written for them.

They share `config.sourceKey`. The engine enforces uniqueness of a source key per **workflow id**
rather than per revision (`WorkflowRegistryService.assertUniqueSourceKeys`), which is the rule
saying the key belongs to the product: two revisions of one onboarding must not split its traffic
at the provider. Starting an onboarding without naming a version therefore picks revision 2, and an
onboarding already in flight stays on the revision it was created with.

**One document, both routes.** A workflow definition may contain at most **one KYC-parked
step**: the connector's callback submits the closed, un-suffixed key set `kycOutcome` /
`kycRetryStep` / `kycReasonCodes` / `kycCustomerMessage` / `kycAttemptCount`, the engine re-submits it through the step
that parked, a key the step does not declare is an `UNKNOWN` field error that loses the verdict, and
field names are unique across a whole definition. Branching to several KYC steps is
therefore not available, and everything that varies per applicant — issuing country and document
type alike — has to vary _within_ one declaration.

`config.documents[].countryField` is what allows that. A document mapping may name a connector
payload key holding the applicant's own ISO alpha-2 issuing country instead of fixing a country in
config — exactly one of `country` / `countryField`, enforced by `parseKycConfig`. A fixed country is
accepted as alpha-2 or alpha-3 and the kernel normalises everything to alpha-2 through an ISO table
of all 249 assigned codes; Sumsub converts back to alpha-3 at submit.
So **country is not a reason to add a file**: one declaration serves the whole perimeter.

`idDocType` has no payload equivalent and stays fixed per `documents[]` entry, so a workflow offering
a choice declares one entry per type and lets the applicant pick between them:

- `select_document_type` collects `documentType` (`PASSPORT` / `ID_CARD`) and the matching issuing
  country — 30 states for a passport, 28 for a card, since **Denmark and Ireland issue no national
  identity card** and such a card is issued only to nationals of the issuing state. Residence
  (`country`) accepts all 30 either way: living in Copenhagen with a Polish card is ordinary.
- Its `success` arms both carry a `when`, routing to `capture_passport` or to
  `capture_id_card_front`, so an applicant only ever walks the capture steps for the document they
  chose — a passport is single-sided, a card has a mandatory back.
- **`optionalFieldMapping`** on the connector declaration holds the sources that may legitimately be
  absent. `buildPayload` omits an absent optional source instead of throwing, and a `documents[]`
  entry marked `optional` whose payload key never arrived is skipped rather than failing the step.
  So a passport applicant uploads a passport and a selfie, a card applicant uploads two sides and a
  selfie, and one declaration serves both.
- **Optional mappings are exempt from the dominator rule**, which is what makes the branch legal at
  all: a required mapping may name only a field written in the connector's own step or in one that
  always runs before it, while a source written on one branch and absent on the other is precisely
  what an optional mapping declares. The persist requirement still applies — an unpersisted
  cross-step source is absent on _every_ path, an authoring error rather than optionality.

Both revisions declare two agreement families at the document root — `eu-b2c-terms` against
`collect_contact`'s `termsAccepted` and `eu-b2c-privacy-notice` against its
`privacyNoticeAcknowledged` — so both must have a published version before an onboarding on this
workflow can start (§2, §9). Revision 2 collects those two fields through the `consents` member of
`collect_contact` rather than declaring them by hand; the families themselves are declared the same
way in both. Neither is named with a version: the `termsVersion` and `privacyNoticeVersion` text
fields this replaces are gone from the document.

Adding a jurisdiction means extending `nationality`, residence `country` and whichever issuing-country
enums the state belongs in — plus, for Sumsub, the level, which is per declaration. Adding a document type
means a `documents[]` entry, its capture steps and a routing arm on `select_document_type`.

Four further details are consequences of engine behaviour rather than of the business flow:

- **Every callback field the connector can write is declared**, not just `kycOutcome` and
  `kycRetryStep`. `buildKycSubmittedData` attaches `kycReasonCodes` and `kycCustomerMessage` to every
  `retry` and `refused` verdict, so a document that omits them loses exactly the verdicts that carry
  a reason; likewise `kycAttemptCount` on a `retry` from a provider that does not count attempts. The
  Sumsub revision 1 files declare four, because Sumsub counts attempts itself and the kernel never
  writes the fifth for it; the Veriff files declare all five. Declared as `data`, they are still the
  connector's: a client submit carrying one is refused as `CALLBACK_ONLY` (the callback-fields guard,
  above), which is what keeps the kernel's running `kycAttemptCount` honest.
- **Each retry arm returns to a step the reset data can be re-collected from** — `IDENTITY` to
  `select_document_type`, so a customer whose document was refused may also switch to the other one;
  `SELFIE` to `capture_selfie`; `QUESTIONNAIRE` to `collect_purpose` (the questionnaire is
  re-submitted on every execute, so that one converges). `APPLICANT_DATA` is the exception and goes
  to **manual review**: `createApplicant` returns the _existing_ applicant on a repeat
  `externalUserId` and the adapter has no way to update `fixedInfo`, so re-collecting personal data
  could never reach Sumsub — routing it back to `collect_personal` would ask the customer to retype
  into a void. Each arm pairs `kycRetryStep` with `kycOutcome` inside an `all` block, because
  persisted context keys are never deleted and a `kycRetryStep` from an earlier pass survives.
- **No callback field caps a length the provider controls.** `kycCustomerMessage` carries the provider's own
  free text (Sumsub's `moderationComment`, Veriff's decision `reason`), which has no length guarantee; a `maxLength`
  on it fails the parked step's own validator and loses the verdict outright.
- **`manual_review` declares a recursive `success` transition.** `canSubmit: false` is advisory;
  the submit endpoint guards only on approved/completed and on a parked step (`409
ONBOARDING_AWAITING_CONNECTOR`, §3), so without a `success` arm a stray empty POST on a
  review step resolves to no transition and lands the onboarding in terminal `invalid`.

`provision_account` names the generic HTTP connector with a placeholder URL; a deployment repoints it
at its own account system. It sends the onboarding id as an `Idempotency-Key` header, because a retry
must not open a second account. `await_account` then takes `userId` as an ordinary submitted field —
the HTTP connector discards response bodies, so the host BFF delivers the id through the normal
submit endpoint.

`verify_phone_code` routes `CHALLENGE_EXPIRED` and `CHALLENGE_NOT_FOUND` to `resend_phone_code`,
which issues a fresh code and hands the customer back — see the `reason` filter in §2. Deliberately
absent from that list is `ATTEMPTS_EXHAUSTED`: a fresh verification resets the provider's attempt
counter, so recovering from it would turn the step into an unbounded SMS-sending loop, which is a
pumping-fraud vector rather than a usability fix. Exhausted attempts refuse.

One limitation remains inherent to the engine: because context keys are never cleared, a
`kycCustomerMessage` written by an earlier `retry` survives into a later `verified` pass, which a
consumer reading it must account for.

#### `fixtures/` — e2e flows, skipped when `NODE_ENV=production`

A fixture family cannot be extended from `users/` either. On production, where fixtures never load,
a users file reusing a fixture id would create a `users` family of that name and then fail on every
development database that stored the fixture — author such flows under an id of their own.

Each fixture is a flow an e2e suite starts onboardings on, written once. The ones below predate the
specialized step types and are written as `custom` steps, one per compiled step, which is the shape
any untyped document converts to; a new fixture is written in specialized step types. Nothing else
lives here: a suite that needs a one-off flow writes it into a temporary `WORKFLOWS_USERS_DIR`
instead.
`packages/engine/src/workflows/checked-in-workflows.spec.ts` runs the adapters' load-time config
checks over every checked-in file, holds every connector `sourceKey` to one family across all three
scopes, and holds each fixture's file name to its `id`, which the fixtures site keys its URL by.

| File                                 | Connector types                             | Demonstrates                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `base`                               | `kyc`                                       | Multi-step chain, two connectors on one step, root notify webhook, per-transition suppression, one root `agreements` declaration (`base-terms`, bound to `accept_terms`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `conditional-fields-and-transitions` | `kyc`                                       | `when` on fields and on transitions, `persist: false`, branching manual review                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `otp-sms`                            | `otp_verification`                          | The engine-owned `twilio_sms_otp` connector over the `sms` channel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `otp-email-typed`                    | `otp_verification`                          | `otp-verify` over the `email` channel after a `contact-details` that omits the phone number, run against the real `smtp_email_otp` connector by `packages/engine/test/otp-email.e2e-spec.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `sendgrid-email`                     | `email_delivery`                            | Dotted `fieldMapping` targets (`dynamicTemplateData.first_name`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `file-upload`                        | `kyc`                                       | `file` field plus the document reservation flow                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `manual-review`                      | none                                        | All three manual triggers and a recursive `success` transition                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `scoring`                            | `otp_verification`, `kyc`, `email_delivery` | Two root scores (`risk` 0-100, higher worse; `trust` 0-50, higher better) across an 11-step individual KYC flow; `collect_profile` scores both from applicant data and gates straight to `manual_review` or falls through to `request_code`; the sync `twilio_sms_otp` step (`verify_code`) carries a `trust` rule gated on `pepSelfDeclared` being `false`, so a proven phone raises identity confidence but a self-declared PEP cannot offset their exposure with it, and the async `sumsub_kyc` step (`submit_kyc`) also carries scoring rules, with `submit_kyc`'s `retry` outcomes looping back to `capture_identity` / `capture_selfie` and accumulating `risk` across attempts until a later `verified` pass can still land on `manual_review`; `manual_review` declares a score-gated `manual.invalid` arm (`risk <= 45`) ahead of its unconditional `manual.invalid` fallback, so an operator can send a borderline case back to `request_code` for another phone verification instead of only approving or rejecting |

---

## 3. Runtime evaluation

`packages/engine/src/workflows/domain/` — deliberately free of Nest decorators and HTTP types, per
`packages/engine/CLAUDE.md` ("Architecture").

- **`Workflow`** wraps a normalized definition and owns `initialize()`, `evaluate()` (data submit),
  `evaluateManual()` (operator trigger), and the webhook policy lookups.
- **`Step`** owns field validation, the step descriptor, and transition resolution. It pre-compiles
  one Ajv validator per field plus a whole-step validator, and caches validators for
  _active-field subsets_ (LRU-ish, 64 entries) because the active subset varies with `when`.
- **`WorkflowEvaluationResult`** is a closed result type — `accepted`, `rejected`,
  `parked-async-callback`, `terminal-invalid`, `retryable-invalid-data`,
  `manual-transition-unavailable`, `unknown-evaluation` — each with the projections that outcome
  legitimately carries.

_Reasoning:_ the spec specified XState 5 with machines compiled from the DDL. That was dropped.
The evaluation the engine actually needs is a single function of `(step, submitted data, context)`
to a next state — there is no long-lived actor, no parallel regions, no history states. XState
would have added a serialization format to version and a second place where transition semantics
live. The `WorkflowEvaluationResult` union does the one job that mattered: making every outcome
explicit and forcing the caller to handle each.

### The submit path (`OnboardingsService.submit`)

1. Load the onboarding (outside the transaction) — 404 if missing, with a `rejected_attempt` audit
   record.
2. Open a transaction. `SELECT … FOR NO KEY UPDATE` on the row and refresh the in-memory entity
   from what was locked. This is the concurrency control: two submits for the same onboarding
   serialize, and the second sees the first's committed state. `FOR NO KEY UPDATE` rather than
   `FOR UPDATE` so it does not block rows referencing this one.
3. Snapshot pre-mutation status/step (used by the error-path webhook, §6).
4. Reject if already `approved` or `completedAt != null` — `409 ONBOARDING_COMPLETED`.
5. Reject a client submit while the row is parked: `pendingConnector` set and no
   `continuation.resolvedConnector` — `409 ONBOARDING_AWAITING_CONNECTOR`, carrying the park's
   `connectorId`, `connectorName` and `connectorOrder` (never the `providerReference`). Audited as
   `onboarding.rejected_attempt` with outcome `awaiting_connector`, and the client webhook's
   `notifyError` fires as for the other refusals. _Reasoning:_ a parked KYC step's fields are all
   optional, so `{}` passed the validator and re-ran the connector chain — a second paid provider
   session, whose decision then raced the first's. The step is the provider's to decide; only a
   callback or an operator reconcile (§5) continues it.
6. Re-check a continuation's park under the lock: when `continuation.resolvedConnector` carries a
   `pendingConnector` — the park the adapter correlated the callback against through an unlocked
   read (§4) — and the locked row no longer holds it (`OnboardingEntity.isParkedOn`: `connectorId`,
   `connectorOrder` and `providerReference` all equal), throw `ConnectorCallbackSupersededError`.
   This runs before the completed guard of point 4: a continuation for an onboarding a reconcile
   or another callback has since decided is a redelivery to acknowledge, not a
   `409 ONBOARDING_COMPLETED` the provider would keep retrying.
   The `catch` rethrows it before anything else: no `rejected_attempt` row, no `notifyError`,
   nothing written — the newer attempt's own callback decides the onboarding. The webhook route
   answers it `204` (§5); the reconcile route reports `superseded`.
7. `workflow.evaluate(...)`:
   - `Step.collectAcceptedData` — unknown fields, inactive-but-submitted fields, missing required
     fields, and per-field schema failures all produce `{field: ['UNKNOWN' | 'REQUIRED' |
'INVALID']}`, and a client body carrying a key an async connector of the step writes on its
     callback produces `{field: ['CALLBACK_ONLY']}` before the step validator runs (§2). Any error →
     `400 INVALID_STEP_DATA` with the error map; the state is unchanged and the client retries.
   - Connector chain runs (§4) against `connectorData` merged over context.
   - Outcome maps to a trigger: accepted → `success`, rejected → `rejected`, pending → park,
     invalid-data → either retryable (back to the client) or terminal-invalid. A retryable
     refusal reached through a continuation — the provider delivered, and what it delivered is
     that the step's data is wrong, as a one-time code the user mistyped — releases the park in a
     second, locked transaction once the refusing one has rolled back (`releasePark`). A
     continuation that names its park must still match it (`isParkedOn`); one that only knows its
     slot — the fixture adapters correlate through their own stores — matches the park on that
     connector order. Either way a newer attempt's park is left alone. The step is then the client's to
     resubmit instead of parked for good behind the `409` of point 5.
   - Scores recalculate here, immediately before target resolution: `Scoring.applyRules` sums the
     current step's `scoring` rules onto the onboarding's scores and clamps once (§2). This sits
     after the connector chain, not before it, so it runs exactly once per resolved transition — a
     pending outcome returns above this point without scoring, and its callback resume re-runs
     `evaluate` and scores once when the chain finally resolves.
   - `Step.resolveTransition(trigger, transitionContext, rejectionReason)` picks the **first**
     transition whose status matches, whose `reason` covers the refusal, and whose `when` holds.
     Order in the JSON is the precedence. Since the unconditional fallback is optional (§2), a
     trigger whose arms all fail resolves to no transition, which ends the onboarding `invalid`.
     A refusal's reason is kept in the next state's `rejectionReason` wherever it routes — a
     terminal step, manual review — except to a step awaiting the user, such as an expired code's
     re-send step, which carries none.
8. Assign the next state, save, and write the `onboarding.state_transition` audit row **inside the
   same transaction**. A next state that parks is stamped first: `stampParkedAt` sets
   `pendingConnector.parkedAt` (ISO-8601) when the record has none, and leaves a re-park's stamp
   alone — the stamp sits here, not in `Workflow`, so the domain stays clock-free. A continuation
   then writes the row that says who applied the connector's result (`logAppliedContinuation`):
   `origin: 'provider_callback'` writes `webhook.inbound_callback_applied`, `origin:
'admin_reconcile'` writes `onboarding.pending_connector_reconciled` naming the operator (§8).
9. Commit, then notify the client webhook (§6) outside the transaction.

Anything that resolves to no valid transition ends at the terminal `invalid` status with
`completedAt` set, rather than throwing. _Reasoning:_ an onboarding that cannot advance is a
business outcome the operator needs to see in the list and the audit log, not a stack trace.

### Manual review

`POST /v1/onboardings/:id/review/:action` with `action ∈ {approve, reject, invalid}` fires
`manual.<action>`. Same locking and audit discipline; the audit action is
`onboarding.manual_review_decision` and carries the trigger. An unsupported action is rejected by
`UnsupportedManualReviewActionPipe`, which also writes a `rejected_attempt` audit record before
throwing — so an operator's bad request is still evidence. A manual decision passes the
onboarding's current scores through unchanged: it submits no step data, so there is nothing for a
`scoring` rule to read.

If the current step declares no matching manual transition, the result is
`409 MANUAL_TRANSITION_NOT_AVAILABLE` and nothing is written. _Reasoning:_ manual review is
authority-bearing; silently ignoring an approve that the workflow does not permit would be worse
than failing.

### The `/state` descriptor

`GET /v1/onboardings/:id/state` returns everything a client needs to render the current step
without knowing the workflow:

```jsonc
{
  "onboardingId": "…",
  "workflowId": "base",
  "workflowVersion": 1,
  "status": "awaiting_user",
  "currentStep": "collect_email",
  "terminal": false,
  "rejectionReason": null,
  "step": {
    "name": "collect_email",
    "status": "awaiting_user",
    "canSubmit": true, // the step declares a success transition
    "schema": {/* JSON Schema for the currently active fields */},
    "fields": [
      {
        "name": "email",
        "type": "text",
        "required": true,
        "active": true, // resolved against persisted context
        "dependsOn": [], // fields this one's `when` reads
        "when": {/* the raw condition, so the client can re-resolve as the form fills */},
        "schema": {/* per-field JSON Schema */},
        "value": null, // persisted value, for prefill
        "upload": {/* file constraints, when applicable */},
      },
    ],
  },
}
```

_Reasoning:_ the step schema returned here is produced by the **same** compiler the submit path
enforces, so a client that satisfies it cannot be surprised. `when` and `dependsOn` are exposed
rather than only the resolved `active` flag, because the server resolves against _persisted_
context while a form's conditions depend on values the user is still typing — the client must be
able to re-resolve locally. `upload` exists because JSON Schema cannot express content types and
size limits.

---

## 4. Connectors

`packages/engine/src/connectors/`.

A connector declaration on a step is:

```jsonc
{
  "name": "send_code", // instance name, unique within the step
  "id": "twilio_sms_otp", // resolves to a registered adapter's `id`
  "type": "otp_verification", // what that adapter does; must match the adapter's own `type`
  "order": 1, // execution order within the step
  "async": false, // true → initiate, park, resume on callback
  "canReject": true, // this call may reject; constrains the step's `rejected` routing
  "fieldMapping": { "recipient": "phoneNumber" }, // payloadKey → context/field name
  "config": { "operation": "send", "channel": "sms" },
} // adapter-specific, validated at load
```

A declaration may also name `errorHandler` — the `id` of a registered `ConnectorErrorHandler`,
defaulting to `fallback_on_error` when omitted — `retry`, how many attempts it is worth and how
long to wait between them, and `fallback`, an ordered **chain** of further declarations of the same
`type` that take its place as each one runs out of attempts:

```jsonc
{
  "name": "primary_email",
  "id": "sendgrid_email",
  "type": "email_delivery",
  "order": 1,
  "fieldMapping": { "recipient": "email", "templateId": "emailTemplateId" },
  "errorHandler": "retry_then_fallback", // optional; defaults to `fallback_on_error`
  "retry": { "maxAttempts": 3, "delayMs": 200 }, // optional; defaults to `{maxAttempts: 2, delayMs: 0}`
  "fallback": [
    {
      "name": "unavailable_email",
      "id": "mock_email_delivery", // a different adapter
      "type": "email_delivery", // required, and must equal the primary's
      "retry": { "maxAttempts": 1 }, // optional; overrides the primary's field-wise, keeping `delayMs: 200`
      "config": { "failWithStatus": 503 }, // optional; defaults to `{}`, never inherited
    },
    {
      "name": "backup_email",
      "id": "smtp",
      "type": "email_delivery",
      "fieldMapping": { "recipient": "email", "subject": "emailSubject" }, // optional; inherits the primary's when omitted
      "config": { "templatePath": "fixtures/manual-smtp.html" },
    },
  ],
}
```

A chain entry carries no `order`, `async`, `canReject`, `errorHandler` or `fallback` of its own
(`workflow-contract.ts`'s `RawWorkflowConnectorFallbackDeclaration`): normalization
(`connector.normalizer.ts`'s `normalizeConnectorFallbacks`) copies the primary's `order`, `async`
and `canReject`, because those three describe the step's slot rather than the provider filling it,
and the primary's `errorHandler` governs the whole slot, its chain included. `fieldMapping` and
`optionalFieldMapping` are inherited from the primary when an entry declares none — and a declared
one replaces the inherited map rather than merging into it, since the executor builds each link's
payload from that link alone, so an entry that dropped the primary's optional sources would send
its provider a narrower payload than the connector it stands in for. `config` is never inherited
and defaults to `{}`. A payload key may not be claimed by both of an entry's resolved mappings,
the same rule the primary is held to. Every `id` in a chain must be distinct — from the primary and from every earlier entry —
since repeating an adapter is what `retry` is for. The JSON Schema
(`workflow-json-schema.builder.ts`) declares `fallback` as an array of 1 to
`MAX_CONNECTOR_FALLBACK_CHAIN_LENGTH` (3) closed objects, so an empty array, a fourth entry, or an
`order`, `async`, `canReject`, `errorHandler` or nested `fallback` inside an entry is rejected at
load rather than silently ignored.

`retry` is resolved on the primary from `DEFAULT_CONNECTOR_RETRY` (`{maxAttempts: 2, delayMs: 0}`)
and on each entry **field-wise over the primary's resolved policy**, so an entry naming only
`maxAttempts` keeps the slot's interval. `CONNECTOR_RETRY_BOUNDS` caps `maxAttempts` at 1–5 and
`delayMs` at 0–5000 in both the JSON Schema and the normalizer; `maxAttempts: 1` means no retries.
The bounds are hard rather than advisory because the connector chain runs inside the onboarding
submit's transaction — see
[decision 0007](decisions/0007-bounded-in-process-connector-retries.md).

### The port

`ConnectorAdapter` (`ports/connector-adapter.port.ts`) is one interface for every provider:
`name`, `id`, `type`, optional `supportsAsyncCallback` + `callbackAuth`, optional `callbackFields`,
optional `validateDeclaration`, required `execute`, optional `mapCallbackResult`. `callbackFields`
lists the `submittedData` keys an async adapter's callback may emit; a step bound to the adapter must
declare each (§2).

`ConnectorExecutionPort` is what the workflow side sees of the adapters. Besides `execute`, `resume`
and `validateDeclarations`, an optional `listAdapters()` returns one `ConnectorAdapterSummary`
(`id`, `type`, `supportsAsyncCallback`, `scope`, `callbackFields`) per registered adapter, which
`ConnectorSelectionRules` filters by the active scopes and judges per step (§2). It is the only seam: the adapter
collection is not exported from `ConnectorsModule`, and the modules already `forwardRef` each other.

`execute` receives `{ declaration, execution: {onboardingId, stepName}, context, payload,
payloadFieldSources }` and returns a `ConnectorExecutionResult`: `accepted` | `rejected(reason)` |
`invalidData(errors, metadata)` | `pending(...)` | `invalid(...)`.

_Reasoning:_ the spec defined seven connector _categories_, each with its own interface (`KycConnector`,
`PhoneVerifyConnector`, …) plus a registry resolving `(category, providerId)`. That was replaced by
one flat interface and resolution by `id`. Categories bought nothing the workflow author could
not express: a step already declares which connector runs and what data it gets, and the engine
never needs to know that a call "is KYC". Meanwhile categories cost a taxonomy that every new
provider must be forced into. Removing them is what makes `http_request` possible at all — a
generic connector has no category.

`fieldMapping` and `optionalFieldMapping` are the two channels from onboarding data into a
connector, and what they may name is settled at load time: the source field must be written in the
same step, or in a step that persists the value and that every path from `initial` passes through
(§2). A mapped source field missing from the context at runtime still throws
`ConnectorPayloadFieldNotFoundError`, but that is a backstop rather than the primary check.

An **optional** mapping declares a source that may legitimately be absent, and is exempt from the
"every path passes through" half — a field written on one branch and absent on the other is exactly
what it describes. The persist requirement still applies, since an unpersisted cross-step source is
absent on every path rather than some. At runtime `buildPayload` omits an absent optional source
instead of throwing. A payload key may not appear in both maps.

_Reasoning:_ connectors should never see fields a step did not declare; this makes the data flow
into a third party auditable by reading the workflow JSON alone. Proving reachability with a
dominator analysis rather than trusting the author is what lets that audit be static — a workflow
whose connector could be reached down a branch that never collected its inputs fails to load
rather than failing on someone's onboarding.

### Execution and chaining

`WorkflowConnectorExecutorService` sorts declarations by `order` and runs them sequentially. The
first non-`accepted` result short-circuits and becomes the step's outcome. On `async: true` the
adapter's `execute` initiates the work; if it accepts, the executor returns
`pending({connectorName, connectorId, connectorOrder, providerReference?})` and the remaining
connectors are **not** run. `providerReference` is copied from the adapter's accepted result
(`metadata.providerReference`, when a string) and becomes part of the persisted pending connector
(§5).

`resume(...)` re-enters the chain with a completed connector's order and result, skipping
everything at or below it. That is the whole resumption mechanism: the parked onboarding stays on
its step, and the callback replays the same evaluation with the missing piece supplied.

**When a declaration's adapter throws**, `WorkflowConnectorExecutorService` asks the declaration's
error handler what to do next — a registered `ConnectorErrorHandler`
(`connectors/ports/connector-error-handler.port.ts`), resolved from `errorHandler` and defaulting
to `fallback_on_error` when the declaration names none. A handler sees only a thrown error, never
a returned `ConnectorExecutionResult`: `rejected`, `invalidData` and `invalid` are the adapter's
own answer and never reach a handler, because re-asking another provider after one already said no
would let an applicant shop for a yes. `handle` is synchronous and pure, and returns one of four
actions:

| Action      | Effect                                                                                                                                                                                                                                                                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `retry`     | Waits the declaration's `retry.delayMs`, then calls the same connector again with `attempt` incremented, up to its own `retry.maxAttempts`. Past that cap, or past the slot's 20-second waiting budget (`MAX_CONNECTOR_SLOT_RETRY_DELAY_MS`), the executor overrides the decision to `propagate` — the handler is a policy, not a loop guard. |
| `fallback`  | Runs the next link of the declaration's `fallback` chain in its place, `attempt` reset to 1. At the end of the chain the executor overrides to `propagate`.                                                                                                                                                                                   |
| `continue`  | The slot yields `ConnectorExecutionResult.accepted()` and the chain proceeds to the next `order`; on an `async` declaration the step does **not** park, since nothing was initiated.                                                                                                                                                          |
| `propagate` | Rethrows, unchanged. The step does not advance and the caller sees the provider's error — today's behaviour, and what an unhandled declaration does.                                                                                                                                                                                          |

The slot's chain is `[declaration, ...declaration.fallbacks]`, walked by index: a `retry` repeats
the current index, a `fallback` moves to the next one. The interval is waited with `setTimeout`
from `node:timers/promises` and only ever before an attempt that will actually happen, so a
decision the executor overrides never costs an onboarding a delay it did not need.

Adapter resolution, payload building and the `supportsAsyncCallback` assertion all run outside the
`try` guarding `adapter.execute(...)`: each is an authoring mistake rather than a connector
failure, and routing it through a handler would hide it behind a fallback. Because a chain entry is
a full normalized declaration, the async path needs no special case: the `pending(...)` built from
it names that entry's own `name` and `id` with the primary's `order`, so the provider's callback
still arrives at its own `/v1/webhooks/<id>/callback`, and
`AwaitingCallbackConnectorResolver.findConnector` resolves it by matching each step connector _and_
every link of its chain, or, for an onboarding whose park is recorded, from the persisted pending
connector (§5; `resolvers/awaiting-callback-connector.resolver.ts`).

Three handlers ship in `connectors/error-handlers/built-in/`, documented in
[`error-handlers/README.md`](../packages/engine/src/connectors/error-handlers/README.md):

| id                    | Decides                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fallback_on_error`   | Falls back when one is available, else propagates. The default a declaration gets when it names no `errorHandler`.                                                              |
| `retry_then_fallback` | A 4xx status goes straight to fallback-or-propagate; a 5xx or statusless failure retries while the declaration's own `retry.maxAttempts` allows, then falls back or propagates. |
| `continue_on_error`   | Always continues.                                                                                                                                                               |

An operator swaps one for another by editing `errorHandler` in the workflow document; a team adds
a fourth under `error-handlers/users/`, exactly as `adapters/users/` already works for adapters.

Every decision the executor ends up acting on writes one `connector.*` audit row and one
application-log line naming the onboarding, step, failing connector, handler and action — see
[`audit-log-contract.md`](../packages/engine/docs/audit-log-contract.md).

Startup assertions in `ConnectorsModule`: adapter `id` values must be unique across every group,
any adapter with `supportsAsyncCallback: true` must declare `callbackAuth`, and error handler `id`
values must be unique across all registered handlers (`assertUniqueConnectorErrorHandlerIds`).
`type` values are deliberately shared — three adapters declare `kyc`, three declare
`email_delivery` — since a type names a capability, not a provider.
`WorkflowConnectorExecutorService.validateDeclarations`, run for every stored revision at boot,
additionally resolves each declaration's `errorHandler` against the registered collection —
throwing `ConnectorErrorHandlerNotRegisteredError` when it is unknown — and validates every link
of a `fallback` chain exactly like a primary: adapter-`type` agreement
(`ConnectorTypeMismatchError`), then — for a link under an `async` primary, whose `async` it
inherits — that its own adapter declares `supportsAsyncCallback`, then the adapter's own
`validateDeclaration`. These run over every loaded
file before it is persisted as well as over every stored revision; see "Load and validation" above.

### Operator-provided settings

An adapter may declare a `settingsSchema` on `ConnectorAdapter` — a list of
`{key, secret, required, pattern?}` fields. `pattern` is an optional
`RegExp` a submitted value must match, checked in the same collect-all-issues validation as every
other rule; only `twilio_sms_otp`'s `accountSid` and `messagingServiceSid` and `sendgrid_email.from` declare one today. An
adapter with no `settingsSchema` is not configurable and does not appear on the admin API below —
`http_request` is the shipped example, since its secret aliases are named by workflow JSON rather
than by the adapter and so remain deployment configuration (`HTTP_CONNECTOR_SECRETS`).

Each key resolves in this order at **execution time**:

```
stored value (connectors row) → unset
```

The database is the **only** source. There is no environment fallback: a credential absent from
`connectors` is unconfigured, full stop, and raises `503 CONNECTOR_NOT_CONFIGURED` —
distinguishable from a provider outage. `ConnectorSettingsService.resolve(adapter)` does the
resolving; it depends only on the repository and `DataSource`, never on
`CONNECTOR_ADAPTER_COLLECTION` — an adapter passes itself (`resolve(this)`) rather than an id
string, so it never needs a registry lookup to find its own schema. Turning a `connectorId`
string into an adapter is instead `ConnectorSettingsAdminService`'s job, reached only from
`ConnectorsController`; giving the resolution path that same dependency would close a cycle,
since the adapter registry's factory already injects every adapter.

Declared schemas:

| Id               | Keys                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sendgrid_email` | `apiKey` (secret, required), `from` (required, must match an email-address `pattern`)                                                                                                           |
| `twilio_sms_otp` | `accountSid` (required, must match `^AC[0-9a-fA-F]{32}$`), `authToken` (secret, required), `messagingServiceSid` (required, must match `^MG[0-9a-fA-F]{32}$`) — see "The OTP connectors" below. |
| `smtp`           | `username`, `password` (secret) — neither required alone, but one without the other is rejected                                                                                                 |
| `sumsub_kyc`     | `appToken` (required), `secretKey` (secret, required), `callbackSigningSecret` (secret, required)                                                                                               |
| `veriff_kyc`     | `apiKey` (required), `sharedSecretKey` (secret, required)                                                                                                                                       |

Stored values are one flat `Record<string, string>` per connector, held as plaintext JSON in the
`connectors` table (`id` primary key, `type`, `settings jsonb`, `updated_at`, `updated_by`) — see
§9. **Confidentiality of credentials at rest is the database's responsibility, not the
engine's**: the encryption layer of §9 covers `onboardings.context` only, so a dump, a replica or
any `psql` session exposes every connector credential in clear (see decision records 0024 and
0025). There is no cache: every execution re-reads the row, so a credential submitted over the admin API takes
effect on the next call on every instance without a restart.

Five guarded routes, all behind `AzureJwtGuard`, form the admin surface:

| Method | Path                                | Does                                                    |
| ------ | ----------------------------------- | ------------------------------------------------------- |
| GET    | `/v1/admin/connectors`              | Lists every configurable connector's settings state     |
| GET    | `/v1/admin/connectors/:connectorId` | Reads one connector's settings state                    |
| PUT    | `/v1/admin/connectors/:connectorId` | Replaces its stored settings wholesale                  |
| PATCH  | `/v1/admin/connectors/:connectorId` | Merges only the submitted keys into its stored settings |
| DELETE | `/v1/admin/connectors/:connectorId` | Drops the stored row, leaving every key `unset`         |

A response identifies the connector with the same `id` / `type` pair a workflow declaration uses:
`id` is the adapter's own identifier (`twilio_sms_otp`), `type` is its capability from
`CONNECTOR_TYPES` (§2), so `sendgrid_email` and `smtp` are both `email_delivery`. `type` is declared
by the adapter, never submitted by an operator — a capability is not a configuration choice, and the
list endpoint has to report one for connectors that have no stored row at all. It is stamped onto
the row on every settings write, so a stored row still describes itself when read straight from the
database.

A response also carries `scope` — `built-in`, `fixtures` or `users` — naming the provider array
the adapter is registered in (`connectors.module.ts`), matched by exact constructor identity. It
is derived at request time, not read from the `connectors` table: that table only ever holds
settings for adapters that already exist, so it cannot say which group one belongs to. Every
adapter shipped today reports `built-in`; a deployment's own adapter reports `users` as soon as
it is registered in `USER_CONNECTOR_ADAPTER_PROVIDERS`, with nothing else to declare.

A response's `settings` entries carry `key`, `secret`, `required`, `source` (`stored`/`unset`)
and `value` — `value` is present only when `secret` is `false`; a secret's value never leaves the
engine, not even masked. `PUT`'s body is `{ settings: Record<string, string> }` and rejects with
`400 CONNECTOR_SETTINGS_INVALID` on an undeclared key, a missing
required key, a non-string/empty value, a value that fails a field's declared `pattern` (for
example `twilio_sms_otp`'s `messagingServiceSid` and `sendgrid_email.from`), or — because `PUT` replaces
the map wholesale — a body that silently omits a key that is currently stored. That last case
names every key that would be dropped and is refused unless the request carries `?replace=true`,
the explicit opt-in to drop them. `smtp` additionally rejects `username` or `password` supplied
alone: an unauthenticated SMTP session is a real configuration, but only when neither key is
sent. Every issue is collected and reported at once, naming every offending key — but never the
same key twice. A key whose own value is refused is held out of the validated map, and the
required-key and `smtp` pairing checks read that map, so they skip it rather than reporting the
absence they would otherwise see there; without that, one bad value also claimed the key was
missing, of a key the request plainly carries. A key removed by an explicit `null` is not refused
and is still reported missing. A `connectorId` naming an unregistered adapter, or one with no
`settingsSchema`, answers `404 CONNECTOR_NOT_FOUND`.

`PATCH`'s body is `{ settings: Record<string, string | null> }` and merges into the stored map
instead of replacing it: a string value overwrites that key, a JSON `null` deletes it, and a key
absent from the body is left exactly as stored — an empty string is still an invalid value, not a
deletion. Validation applies the same rules as `PUT`, checked at different granularity: an
undeclared key, a non-string/empty value and a field's `pattern`
are checked against each **submitted** key, while a missing required key and the `smtp`
username/password pairing are checked against the **merged** result — so deleting a required key,
or deleting `smtp.password` while `username` stays stored, is still refused, naming the key.
`would_be_dropped` is never raised by this route, since nothing is dropped implicitly, and an
empty `settings` object is refused with `400 CONNECTOR_SETTINGS_INVALID`. `PUT` is unchanged by
this route's addition: it remains the wholesale replace described above, including
`?replace=true` and the `would_be_dropped` rule — it is simply no longer the route the admin panel
calls to save a change.

Every write — `PUT`, `PATCH` and `DELETE` alike — runs its read and its write inside one
transaction that first takes a connector-scoped Postgres advisory lock
(`pg_advisory_xact_lock` on the connector id, in `ConnectorsRepository.lock`). All three are
read-modify-writes that store the whole settings map, so without it two overlapping requests
each read the same starting map and the later write erases the keys the earlier one added — a
lost update, not a conflict either caller would notice. An advisory lock rather than
`SELECT … FOR UPDATE`, because the first write to a connector has no row to lock and is exactly
when two concurrent requests are most likely; Postgres releases it when the transaction ends.
The audit row is written afterwards, in its own transaction, so recording the change cannot roll
one back. `connector-settings.e2e-spec.ts` proves it with concurrent `PATCH`es against the real
database, each updating a different key of one connector, and asserts every update survives.

### Registered adapters

Every mock's connector id, class name and filename begin with `mock`, so a mock is
recognisable wherever it appears — in a workflow declaration, an audit row or the
adapters directory.

| Type                       | Kind        | Notes                                                                                                                                                                                                           |
| -------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http_request`             | **Generic** | Config-driven outbound JSON call. Env-configured secrets; see `packages/engine/docs/http-request-connector.md`.                                                                                                 |
| `sendgrid_email`           | Real        | Dynamic-template send; dotted `fieldMapping` keys build nested payloads.                                                                                                                                        |
| `smtp`                     | Local       | Nodemailer to MailHog; HTML template from `config.templatePath`. Plaintext SMTP is only permitted when the host is literally `mailhog`.                                                                         |
| `smtp_email_otp`           | Local       | Engine-owned one-time codes by email through `smtp`; extends `BaseOtpConnector`, see "The OTP connectors" below.                                                                                                |
| `sumsub_kyc`               | Real        | KYC via Sumsub; `async: true`-only (park on `execute`, resume on the provider's callback). See "The KYC connector" below.                                                                                       |
| `twilio_sms_otp`           | Real        | Engine-owned one-time codes by SMS through Twilio Programmable Messaging; extends `BaseOtpConnector`, see "The OTP connectors" below.                                                                           |
| `veriff_kyc`               | Real        | KYC via Veriff, API-only; the same kernel and the same `async: true`-only contract as `sumsub_kyc`. See "The KYC connector" below.                                                                              |
| `mock_kyc_1`, `mock_kyc_2` | Mock        | Always accept, after a five-second delay. Two exist so `base` can show ordered connectors in one step.                                                                                                          |
| `mock_otp`                 | Mock        | In-memory OTP challenge with TTL and attempt budget, keyed by onboarding and channel; rejects with `ATTEMPTS_EXHAUSTED` / `CHALLENGE_EXPIRED` / `CHALLENGE_NOT_FOUND`.                                          |
| `mock_email_delivery`      | Mock        | Keeps the templated message in memory instead of sending it.                                                                                                                                                    |
| `mock_sumsub_file_upload`  | Mock        | Reads a completed document from object storage.                                                                                                                                                                 |
| `mock_async_callback`      | Mock        | The async/callback reference implementation; declares `callbackAuth: {kind: 'none'}` with a justification.                                                                                                      |
| `mock_async_callback_2`    | Mock        | The same adapter under a second id with its own initiations, declaring one callback field (`providerVerdict`); lets a slot be switched between two callback-capable adapters and shows the callback-only guard. |

### The OTP connectors (`twilio_sms_otp`, `smtp_email_otp`)

Every `otp_verification` connector extends the abstract `BaseOtpConnector`
(`adapters/built-in/otp/base-otp.connector.ts`), and each provider is its own connector with its own
id, settings row and audit trail. **The engine owns the code**: the base class generates it, stores
it, checks it and expires it; a subclass names its `id` and its one `channel`, declares the
`settingsSchema` it reads, and implements `deliver(recipient, code)` — the only provider-specific
part. `deliver` returns `delivered`, or `invalid_recipient` when the provider refuses the address or
number itself, and throws for everything else. The declaration it serves carries the derived
`config: { operation: 'send' | 'check', channel: 'sms' | 'email' }` (§2.1), and its payload is
`recipient` on a send and `recipient` plus `code` on a check. A declaration whose `operation` is
neither value, or whose `channel` is not the connector's own, fails at startup through
`validateDeclaration` (`OtpDeclarationInvalidError`), so an email connector bound to an `sms` step
never boots.

Because providers are ordinary connectors, switching one is an edit to the declaration's `id`, and
failing over is the declaration's `fallback` chain and `errorHandler` (§4): a `deliver` that throws
stores nothing, so the next provider in the chain sends a fresh code. Challenges are keyed by
onboarding and channel, not by connector, so the check step's connector finds a code that any
connector of the same channel sent — the primary checks what its fallback delivered.

Named constants in the base class, not configuration: a six-digit code, a ten-minute lifetime, five
check attempts per code, five sends per challenge.

| Call                             | Result                                                                                    |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| send                             | `accepted`, after `deliver` returned                                                      |
| send, past the fifth send        | `rejected` with `ATTEMPTS_EXHAUSTED`, nothing stored or delivered                         |
| send, recipient refused          | `invalid_data` on the recipient field (`INVALID`), flagged retryable, nothing stored      |
| send, provider not configured    | throws `ConnectorNotConfiguredException` (`503 CONNECTOR_NOT_CONFIGURED`), nothing stored |
| send, provider could not deliver | throws `OtpDeliveryFailedException` (`500 OTP_DELIVERY_FAILED`), nothing stored           |
| check, no challenge              | `rejected` with `CHALLENGE_NOT_FOUND`                                                     |
| check, expired                   | `rejected` with `CHALLENGE_EXPIRED`                                                       |
| check, wrong code, attempts left | `invalid_data` on the code field (`INVALID`), flagged retryable                           |
| check, wrong code, fifth attempt | `rejected` with `ATTEMPTS_EXHAUSTED`                                                      |
| check, right code                | `accepted`; the challenge row is deleted                                                  |
| missing recipient or code        | `invalid`                                                                                 |
| declaration of another channel   | `invalid`, nothing delivered (startup refuses such a declaration first)                   |

The field named in an `INVALID` error is the source field of the `code` or `recipient` payload
key, so a renamed `codeField` reports under its own name. `otp-verify` routes `CHALLENGE_EXPIRED` and
`CHALLENGE_NOT_FOUND` to its re-send step and every other refusal to `refused` (§2.1). Its send and
re-send declare `canReject` and route `rejected` to `refused` too, so the send past the budget ends
the onboarding instead of leaving it on a step no submit can leave; the hand-written v1 revisions
route their sends the same way.

**What is stored.** One `otp_challenges` row per onboarding and channel (§9): a salted SHA-256 of
the code, the salt, the expiry, the check attempts used and how many times the code was sent. The
code itself is never stored, logged or returned, and is compared with `timingSafeEqual`. A send
replaces the hash, salt and expiry, resets the attempts and adds one to `send_count`; the count
survives every re-send — whichever provider sent it — which is what caps SMS cost per onboarding,
and the row is deleted only when a check succeeds. The row is written only after `deliver`
returned, so a delivery that fails — the provider is down, or its settings are missing — spends no
send and leaves the previous code valid. The rows are written outside the submit's transaction, so a wrong code's spent
attempt survives the rollback that ends that submit. They go through a pool of their own
(`OtpChallengesConnection`, `OTP_DATABASE_POOL_SIZE`, §10), never the main one: the submit already
holds a main-pool connection while the connector runs, and waiting on that same pool for a second
is hold-and-wait — enough concurrent OTP submits would each hold one connection, wait forever for
another, and stop the engine. A wrong code raises `attempts` with one atomic
`UPDATE … SET attempts = attempts + 1 … RETURNING attempts`, so concurrent submits cannot overrun
the budget. A hash does not protect a six-digit code from someone who can read the table; the short
lifetime and the deletion on success do (decision record 0048).

**Providers.** `ConnectorsModule` registers each subclass in `BUILT_IN_CONNECTOR_ADAPTER_PROVIDERS`
like any other adapter; a new provider is one class there (`docs/EXTENDING.md`).

- `twilio_sms_otp` (`TwilioSmsOtpConnector`, channel `sms`) posts `To`, `MessagingServiceSid` and
  `Body` ("Your verification code is NNNNNN.") to Twilio Programmable Messaging,
  `…/Accounts/{accountSid}/Messages.json`, with Basic authentication from the stored `accountSid`
  and `authToken`. All three settings are required; a missing one raises
  `503 CONNECTOR_NOT_CONFIGURED` naming the key. A non-2xx answer whose Twilio error `code`
  refuses the `To` number itself — 21211 invalid, 21610 opted out, 21612 unreachable by SMS, 21614
  a landline — is `invalid_recipient`; any other non-2xx answer, a network failure or a timeout
  (`OTP_SMS_TIMEOUT_MS`, §10) raises `OtpDeliveryFailedException`. The response body is read to the
  end either way, so the connection goes back to undici's pool. Operators store the settings on
  the `twilio_sms_otp` connector in the admin panel's Connectors tab.
- `smtp_email_otp` (`SmtpEmailOtpConnector`, channel `email`) renders the built-in template
  `email-templates/built-in/otp-code.html` with `SmtpConnector.renderBody` and sends it with the
  subject "Your verification code" through `SmtpConnector.sendMail`, so it needs SMTP to be enabled
  and configured (§10). It declares no settings of its own and so is not listed by
  `/v1/admin/connectors`. `sendMail` reports a typed outcome, which it maps: an address that is not
  a valid, header-safe email is `invalid_recipient`; `SMTP_ENABLED=false` or an invalid
  `SMTP_FROM`, `SMTP_HOST`, `SMTP_PORT` or `SMTP_TIMEOUT_MS` raises `503 CONNECTOR_NOT_CONFIGURED`
  with `connectorId: 'smtp'` and that key; a transport failure, or a server refusing the recipient,
  raises `OtpDeliveryFailedException`. `SmtpConnector.execute` maps the same outcomes onto its
  connector results for workflow email steps exactly as before.

### The generic HTTP connector

`http_request` performs one synchronous JSON call per step, entirely from `config`. Placeholders
are `{{namespace.path}}` over exactly three namespaces: `payload.<key>` (a `fieldMapping` key),
`secrets.<alias>.<key>` (an entry of the `HTTP_CONNECTOR_SECRETS` environment map), and
`execution.onboardingId` / `execution.stepName`. Response mapping: `2xx` accepts; `4xx` becomes
**retryable invalid data** with field errors read from `response.errorsPath` and translated back
from payload keys to workflow field names via `fieldMapping`; `3xx`/`5xx`/network/timeout throws.

_Reasoning:_ this is the payoff of dropping categories. A provider whose API is plain JSON needs
zero engine code. Three deliberate constraints: there is **no `context` namespace**, so every value
sent must be declared on the step; `response.errorStatuses` exists so a `401` from a rotated
credential is reported as an integration failure rather than blamed on the end user as a field
error; and every `{{secrets.*}}` reference is resolved against `HTTP_CONNECTOR_SECRETS` at
**workflow-load** time, so a missing secret fails startup rather than someone's onboarding. That
env-var source is deliberate, and is the one connector exempt from "Operator-provided settings"
above: the aliases are named by workflow JSON, not by the adapter, so there is no schema an
operator could be shown and nothing for `/v1/admin/connectors` to list.

### The KYC connector

`sumsub_kyc` and `veriff_kyc` are two thin adapters over one kernel,
`connectors/adapters/built-in/kyc/`. The engine-level `ConnectorAdapter` port stays flat and keyed
by `id` — runtime credentials, the webhook route and (below) the callback secret all key on the id —
so the sharing happens one layer down:
[0037](./decisions/0037-kyc-connector-kernel-and-providers.md) records why a second stand-alone
adapter copied from the first was not built.

- **`KycConnector`** (`kyc-connector.ts`, abstract, implements `ConnectorAdapter` with
  `type = 'kyc'` and `supportsAsyncCallback = true`) owns the engine-facing half, identically for
  every provider: parsing the step's compiled `config` (`kyc-config.ts`), resolving and reading every
  captured document before any provider call (`kyc-submission.ts`), building the applicant from the
  eight canonical roles, resolving credentials through `ConnectorSettingsService`, correlating a
  callback, deciding the outcome (`kyc-outcome.ts`), the identity guard
  (`kyc-identity-comparison.ts`), the attempt cap, the closed `submittedData` and the log lines.
  `id`, `name`, `callbackAuth` and `settingsSchema` come from the provider it is built with. A
  document the provider cannot take — `submit` throws `KycDocumentUnsupportedError` before its
  first call — is answered as retryable `invalid-data` on the step field the document was uploaded
  under (`KycDocument.sourceField`), reason `UNSUPPORTED_CONTENT_TYPE`, so the client sees
  `400 INVALID_STEP_DATA` naming the field and uploads again; logged as `KYC_DOCUMENT_UNSUPPORTED
connectorId= onboardingId= field= contentType=`.
- **`KycProvider`** (`kyc-provider.port.ts`) owns the wire half: `id`, `name`, `settingsSchema`,
  `callbackAuth`, `countsAttempts`, `validateConfig(providerConfig, config)`,
  `submit(settings, submission) → {providerReference}`, `parseCallback(input, settings) →
KycCallbackEvent`, `fetchVerdict(settings, event, context) → KycVerdict` and an optional
  `onRetry(settings, event, target)`. A provider that needs more of its webhook between
  `parseCallback` and `fetchVerdict` extends the event type.
- **`SumsubKycConnector`** and **`VeriffKycConnector`** (`sumsub-kyc.connector.ts`,
  `veriff-kyc.connector.ts`) extend `KycConnector`, inject their provider and the kernel's
  dependencies, and call `super`. `connectors.module.ts` registers each connector, its provider and
  its HTTP client.

**Every outcome the callback reports is `accepted()`; the workflow document does all routing.**
`ConnectorRejectionReason` has four members (`ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`,
`CHALLENGE_NOT_FOUND`, `CONNECTOR_REJECTED`), none meaning "identity refused", and
`WorkflowTransitionStatus` is only `success | rejected | manual.*` — so rather than bend the
adapter into that vocabulary, it reports a domain outcome inside `submittedData` —
`kycOutcome: 'verified' | 'human_review' | 'retry' | 'refused'` — and the workflow document routes
on it with `when` conditions (`workflows/built-in/eu-b2c-individual-kyc-eea.workflow.json`, §2). The connector never
returns `rejected()` and does not declare `canReject`. See
[0005](./decisions/0005-kyc-connector-outcome-contract.md).

**`validateDeclaration`** runs at startup over every loaded and stored revision: `parseKycConfig`
(below), then a check that every `documents[].payloadField` and `countryField` is mapped in
`fieldMapping` or `optionalFieldMapping`, then the provider's own `validateConfig`.

**`config`.** `parseKycConfig` reads `sourceKey`, `documents`, `questionnairePathMap` and
`maxAttemptsPerDocSet` (a positive integer, no code default) and passes every other key to the
provider as `providerConfig`, wherever it was authored. A `documents[]` entry names a
`payloadField`, an `idDocSetType`, an `idDocType`, an optional `idDocSubType` and `optional`, and
exactly one of `country` (alpha-2 or alpha-3, normalised to alpha-2) or `countryField`. A malformed
key raises `KycConfigInvalidError` naming it.

**`execute()`** builds the whole `KycSubmission` before touching the provider: every document's
country is resolved first, an optional document the applicant did not supply is skipped, and each
remaining document is resolved through `CompletedOnboardingDocumentResolver` and read from
`ObjectStoragePort` (the same path `mock_sumsub_file_upload` exercises). If no document was supplied,
or one does not resolve, the connector answers `invalid()`; a missing identity field or an unassigned
country throws, being an authoring defect rather than missing input. Only then does it call
`provider.submit` and return `accepted()` — the async park itself is the executor's own `pending()`,
built only because the workflow step declares `async: true` ("Execution and chaining", above), not
by anything the connector returns.

**`mapCallbackResult()`** is the same for every provider:

1. `provider.parseCallback` reduces the webhook to a `KycCallbackEvent`: `onboardingId`, an optional
   `providerReference`, `actionable`, and an opaque `hint` the provider reads back later.
2. An `onboardingId` that is not a UUID can match no onboarding and must not reach a UUID column as
   a cast error: it throws `ConnectorCallbackAlreadyAppliedError`, which the webhook route answers
   with `204` (§5).
3. `AwaitingCallbackConnectorResolver.findConnector({onboardingId, connectorId})` loads the
   onboarding, resolves its workflow, finds the current step and answers **only from the persisted
   park** (§5): the connector's `order` and the `pendingConnector` record the callback is
   correlated against, or `undefined` when the onboarding is gone, terminal, has moved past this
   step, or is parked on a different connector id. There is no fallback to the step's chain: a row
   on the step with no park (a retry verdict cleared it and the client has not resubmitted) logs
   `AWAITING_CALLBACK_PARK_NOT_RECORDED` at warn and resolves to `undefined` too. `undefined`
   throws `ConnectorCallbackAlreadyAppliedError`, which the webhook route acknowledges with `204`;
   that is the redelivery guard. The callback's own id for the onboarding **is** the onboarding id
   the provider was given at submit, so correlation needs nothing from the webhook body beyond it.
4. An event with `actionable: false` re-parks the step with nothing applied (`KYC_CALLBACK_ACKNOWLEDGED`
   at debug). So does an event whose `providerReference` differs from the one recorded on the parked
   connector, compared **before** the verdict is fetched — a late decision for a session a provider
   switch or a retry has superseded (`KYC_CALLBACK_SUPERSEDED`, at log level). The re-park spreads
   the stored record first (`buildParkedResult`), so the recorded reference and `parkedAt` survive
   it. Sumsub's reference is its stable applicant id, so this guard never fires for it.
5. Otherwise `decide` runs: `provider.fetchVerdict` returns a `KycVerdict` — always read back from
   the provider, never taken from the webhook body — and `evaluateKycOutcome` decides. The result
   carries the park it was decided for (`resolvedConnector.pendingConnector`), and the submit path
   compares that with the row it locks (§3, step 6): the resolver's read above was unlocked, so a
   client submit or a switch landing between it and the lock makes the result superseded, and the
   engine drops it rather than applying a decision for an attempt the onboarding no longer waits on.

**`reconcilePending({ onboardingId })`** is the same correlation and decision without the parse,
for an operator whose callback never came (§5). It resolves through the same resolver
(`undefined` throws `ConnectorCallbackAlreadyAppliedError`, which the reconcile service reports as
`superseded`), requires the park to carry a `providerReference` (else
`PendingConnectorReconcileUnsupportedException` with `reason: 'reference_missing'`), asks the
provider for the event to read with — `provider.buildReconcileEvent({ onboardingId,
providerReference })` — and runs `decide` on it. A `pending` verdict is `{ outcome: 'still_pending' }`;
anything else is `{ outcome: 'resolved', callback }`, the same `ConnectorCallbackResult` a webhook
would have produced. Each ask logs `KYC_RECONCILE connectorId= onboardingId= outcome=`. The
providers differ only in the event: Veriff's carries `origin: 'reconcile'`, which makes
`fetchVerdict` answer `pending` for a session with no decision yet where a webhook event throws
`VeriffDecisionNotAvailableError` (a webhook needs the 5xx so Veriff redelivers; an operator's read
has nobody to redeliver); Sumsub's carries the reviewed hint, and its `fetchVerdict` already answers
`pending` while `reviewStatus` is not `completed`.

**`KycVerdict`** is the vocabulary a provider maps its own states onto:

| Verdict                                                                  | Meaning                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| `pending`                                                                | Not decided; the step stays parked and the provider calls again  |
| `needs_review(reason, detail?)`                                          | Human review for a provider-side reason; `detail` is counts only |
| `approved(verifiedIdentity)`                                             | Verified, subject to the identity guard                          |
| `declined(reasonCodes?, customerMessage?)`                               | Refused                                                          |
| `resubmission(target, attemptCount?, limitExceeded?, reasonCodes?, msg)` | The applicant may try again; `target` is a `KYC_RETRY_TARGETS`   |

A state a provider cannot map is **thrown**, never defaulted, so the callback answers 5xx and the
provider redelivers (0005's rule, kernel-wide).

**The kernel's outcome rules**, in order, stopping at the first match (`evaluateKycOutcome`):

1. `pending` parks; nothing is applied.
2. `needs_review` is `human_review` (`KYC_NEEDS_REVIEW`).
3. `approved` is `verified` unless the declared identity does not match what the provider verified,
   in which case it is `human_review` (`KYC_IDENTITY_GUARD_FIRED`). The guard overrides the
   provider's own approval.
4. `declined` is `refused`, with the reason codes and customer message.
5. `resubmission` is `retry` — unless the provider said `limitExceeded` or the attempt count has
   reached `maxAttemptsPerDocSet`, in which case it is `human_review` (`KYC_ATTEMPTS_EXHAUSTED`). The
   cap beats the retry it is capping. On a `retry` the connector calls `provider.onRetry` (a Sumsub
   step reset) before reporting.

**Attempt counting** means two things. A provider that reports attempts itself
(`countsAttempts: true`; Sumsub's per-docSet `attemptCnt`) puts the count on its verdict and the
cap is per docSet. A provider that does not (`countsAttempts: false`; Veriff) leaves the kernel to
count: it reads `kycAttemptCount` from the onboarding's context (0 when never written), adds one for
this resubmission, compares that with the cap — total resubmissions per onboarding — and writes the
new total as `kycAttemptCount` on the `retry`. Persisted context keys are never deleted, so the
total survives from one pass to the next. The kernel never writes `kycAttemptCount` for Sumsub,
which is why the stored Sumsub revision 1, which does not declare the field, keeps working.

**The identity guard** compares the applicant's declared last name and date of birth with what the
provider verified — never first name, where transliteration and middle-name placement are noise.
Both sides are trimmed, case-folded, stripped of diacritics, with hyphen and space folded together;
there is no edit distance and no threshold, because a threshold is not defensible in an audit. A
field the provider returned nothing for is unknown, not a mismatch; when every compared field is
unknown the result is `no-verified-data`, which is not a `match` and lands in review. The declared
side is read through the connector's own `fieldMapping`, not by payload key names. Only field names
are logged, never the compared values.

**`submittedData`** is a closed, declared shape and nothing else — `OnboardingsService.submit`
writes it verbatim into `webhook.inbound_callback_applied` audit metadata (§3, §8):

```ts
type KycCallbackSubmission = {
  kycOutcome: 'verified' | 'human_review' | 'retry' | 'refused';
  kycRetryStep?: 'IDENTITY' | 'SELFIE' | 'APPLICANT_DATA' | 'QUESTIONNAIRE'; // only on retry
  kycReasonCodes?: readonly string[]; // machine-readable provider codes, not identity data
  kycCustomerMessage?: string; // the provider's customer-facing message only
  kycAttemptCount?: number; // only on retry, only for a provider that does not count attempts
};
```

`kycReasonCodes` and `kycCustomerMessage` travel only with `refused` and `retry`; `verified` and
`human_review` carry `kycOutcome` alone. Never present: Sumsub's `clientComment`, MRZ, document
numbers, dates of birth, image bytes, or a raw provider payload.

**Log lines** carry ids, field names and counts, never a provider's free text or a compared value:
`KYC_RETRY`, `KYC_ATTEMPTS_EXHAUSTED`, `KYC_NEEDS_REVIEW` and `KYC_IDENTITY_GUARD_FIRED` (one per
decision, at log level), `KYC_CALLBACK_SUPERSEDED` (log level) and `KYC_CALLBACK_ACKNOWLEDGED`
(debug), each with `connectorId` and `onboardingId`.

#### `sumsub_kyc`

`sumsub-kyc.connector.ts` plus a `sumsub-kyc/` directory: `sumsub-kyc.provider.ts` (the
`KycProvider`), the signing HTTP client, the applicant and questionnaire mapping, the state → verdict
table (`sumsub-outcome.ts`), config parsing and contract constants. `countsAttempts` is `true`.
Its provider-specific keys, `levelName` and `questionnaireDefinitionId` (both required, non-empty),
may sit at the step level of a stored revision or under `connector.config`; Sumsub also requires a
non-empty `questionnairePathMap`, since a level cannot be finalised without a questionnaire.

`submit` reads the Sumsub level and checks it against the **submitted documents' docSets** before any
side-effecting call: `SumsubLevelNotFoundError` if the level is absent,
`SumsubLevelDocSetMismatchError` if a submitted document's docSet is not on the level (containment,
not equality — the reverse is legal, a level carries steps the connector uploads nothing into,
`APPLICANT_DATA` and `QUESTIONNAIRE`), and `SumsubLevelQuestionnaireMissingError` if the level
declares no `QUESTIONNAIRE` docSet. The check is **not cached**: it runs on every execution, so a
level changed at Sumsub after the first fetch is never missed. The documents are read from object
storage before it, the check still precedes `createApplicant`, so a drift costs nothing at Sumsub. It
then creates the applicant (`externalUserId` is the onboarding id), uploads each document with its
country converted to alpha-3, submits the questionnaire and finalizes. The `providerReference` is the
applicant id.

`parseCallback` asserts `X-Payload-Digest-Alg` is `HMAC_SHA256_HEX`
(`SumsubCallbackDigestAlgorithmMismatchError` otherwise — a real downgrade already fails the HMAC
check; this makes the error precise), and takes the onboarding id from `externalUserId` and the
reference from `applicantId`. Event classification: `applicantReviewed` is actionable;
`applicantOnHold` and `applicantAwaitingService` are actionable and decided without a read-back, as
`needs_review` with reason `on_hold_or_awaiting_service`; every other `type`, including one Sumsub
invents later, is acknowledged and dropped.

For a reviewed applicant, `fetchVerdict` reads back the review status, the applicant, the AML case
and, only when the review is `RED`, the per-docSet status, then maps in this order, first match
wins:

| State                                                                                      | Verdict                                                                             |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `reviewStatus` not `completed`                                                             | `pending`                                                                           |
| Screening not resolved: no AML case (Sumsub's `204`), or any hit not `false_positive`      | `needs_review('screening_unresolved', {hitCount})` — overrides `GREEN`              |
| `RED` with `reviewRejectType` `FINAL`                                                      | `declined(buttonIds, moderationComment)`                                            |
| `RED` with `RETRY` and a failed docSet                                                     | `resubmission(docSet, attemptCnt, buttonIds, moderationComment)`                    |
| `GREEN`                                                                                    | `approved({lastName, dateOfBirth})` from the applicant's verified `info`            |
| Anything else (unknown reject type, a `RETRY` with no resolvable docSet, any other answer) | throws `SumsubOutcomeUnrecognisedStateError`; Nest answers `500`, Sumsub redelivers |

A missing `attemptCnt` on the failed docSet counts as 0. An unresolved screening hit is logged as
`SUMSUB_SCREENING_HIT_UNRESOLVED` with the entry key names, `matchStatus` and the hit count only.
`onRetry` resets the failed step at Sumsub.

This is the one place the port changed behaviour: a review answer that is neither `RED` nor `GREEN`
with an identity mismatch used to land in `human_review`; it now throws like every other
unexplained provider state.

Credentials: `appToken`, `secretKey` and `callbackSigningSecret`. `appToken` and `secretKey` sign
every outbound call; `callbackSigningSecret` verifies every inbound one (§5; HMAC-SHA256, hex,
`x-payload-digest`). All are operator-configured through `/v1/admin/connectors/sumsub_kyc` like any
other `settingsSchema` field (above), so the `connectors` table is the only source for both
directions and `configured` on the admin surface means the connector can both call Sumsub and verify
what Sumsub sends back. The signing secret was env-only until
[0006](./decisions/0006-callback-signing-secret-in-connector-settings.md) moved it, after a
deployment reported `configured: true` while rejecting every callback for a missing secret.

Every Sumsub API call — in `execute()` and in `mapCallbackResult()` alike — surfaces a network
failure, a timeout or a non-2xx it cannot otherwise explain as `500 SUMSUB_UNAVAILABLE` (§11); the
one named exception is `finalizeSubmission`'s `409` for missing docSets, which carries their names
back as `SumsubSubmissionIncompleteError` instead of the generic unavailable error. Before the
exception, `SumsubClient` warns with what the exception hides: `SUMSUB_RESPONSE_ERROR method= path=
status=` on every non-2xx (so a `401` from a rotated token reads differently from an outage) and
`SUMSUB_REQUEST_FAILED method= path= error= timeoutMs=` when `fetch` itself rejects, where `error` is
the error's class name only — `TimeoutError` or `TypeError` — never its message, the body or a header.

#### `veriff_kyc`

`veriff-kyc.connector.ts` plus a `veriff-kyc/` directory: `veriff-kyc.provider.ts`, the signing
`VeriffClient`, the `VeriffMediaFitter` and the contract constants. The flow is **API-only**: no Veriff UI is shown to anyone;
the engine creates a session, uploads the images the applicant already captured, and submits it.
`countsAttempts` is `false`. The provider takes no keys of its own under `connector.config`; its
`validateConfig` refuses at startup a `documents[]` entry that maps to no media context.

`submit` always opens a **new session per execute**, never reusing one: a Veriff session is
single-use, and a resubmission after a `resubmission_requested` decision is a new verification
(which also lets the kernel's own counter, not a Veriff state machine, give the cap).

1. `POST /v1/sessions` with `verification: {vendorData, person, timestamp}`. `vendorData` is the
   **onboarding id**; `person` is `{firstName, lastName, dateOfBirth}`. A `document: {type,
country}` prefill is added only when every identity upload agrees on one document type among
   `ID_CARD`, `PASSPORT`, `DRIVERS_LICENSE` and `RESIDENCE_PERMIT` (country alpha-2); a workflow
   offering a choice of document leaves Veriff to detect it. Logged as `VERIFF_SESSION_CREATED`.
   Before it, every document must be an `image/*`: Veriff accepts a PDF on the media endpoint only
   once its Solutions Engineer enables it for the account, which no deployment can assume, so a
   PDF throws `KycDocumentUnsupportedError` with no session created and the kernel sends the
   applicant back to the upload (above). The shipped Veriff workflows narrow their capture fields to
   `image/png` and `image/jpeg` for the same reason (§2 fixtures), and the guard covers a
   user-authored document that does not.
2. For each document, `POST /v1/sessions/{id}/media` with `image: {context, content}`, where
   `content` is a base64 data URI (`data:<contentType>;base64,…`) with the stored document's content
   type. The context follows the document mapping: docSet `SELFIE` → `face`; docSet `IDENTITY` with
   no side or `FRONT_SIDE` → `document-front` (so a passport is `document-front`); `BACK_SIDE` →
   `document-back`. Anything else maps to no context. Before the upload, `VeriffMediaFitter.fit`
   brings an `image/*` document within Veriff's longer-side limit (`VERIFF_MEDIA_MAX_SIDE_PX`,
   1920 px): the engine's own upload cap is in bytes (§7), so a phone photo well under it is still
   refused by Veriff on its pixel dimensions. An image already within the limit passes through as
   the same object; a larger one is resized with `sharp` to fit inside 1920×1920,
   never enlarged, its EXIF orientation baked in first (resizing drops the tag) and its format and
   content type kept. Logged as `VERIFF_MEDIA_DOWNSCALED from=<w>x<h> to=<w>x<h>`, dimensions only.
3. `PATCH /v1/sessions/{id}` with `verification: {status: "submitted"}`, closing the upload phase and
   starting the decision. The `providerReference` is the session id.

Every request carries `X-AUTH-CLIENT` (the `apiKey`) and `X-HMAC-SIGNATURE`, the hex HMAC-SHA256 of
the exact bytes sent under the shared secret — or, for the bodyless `GET`, of the session id.
`VeriffClient` is plain `fetch` under `AbortSignal.timeout`, no SDK. Before every
`VERIFF_UNAVAILABLE` it warns with what the exception hides: `VERIFF_RESPONSE_ERROR method= path=
status=` on a non-2xx (so a `401` from a wrong `apiKey` reads differently from an outage) and
`VERIFF_REQUEST_FAILED method= path= error= timeoutMs=` when `fetch` rejects, where `error` is the
error's class name only — `TimeoutError` or `TypeError` — never its message, the body or a header.

Veriff posts **two shapes to one endpoint**. `parseCallback` first asserts `x-auth-client` equals the
stored `apiKey` (`VeriffCallbackAuthClientMismatchError` otherwise: the HMAC check already proves the
body is Veriff's, so this names an integration mix-up precisely). An **event webhook** (it carries
`action` or `feature`, or has no `verification` object) decides nothing and is acknowledged: its
onboarding id is the top-level `vendorData`, and an event without one gets an empty id, which the
kernel answers as already applied. A **decision webhook** yields `verification.vendorData` as the
onboarding id and `verification.id` as the session id.

`fetchVerdict` **reads the decision back** with `GET /v1/sessions/{id}/decision` and never trusts the
webhook body. A `verification: null` read-back throws (`VeriffDecisionNotAvailableError`) rather than
parking — unlike Sumsub, no later event follows a decision webhook, so only a 5xx makes Veriff
redeliver; a decision whose `vendorData` differs from the callback's onboarding throws
`VeriffDecisionVendorDataMismatchError`. Every decision read back is logged as `VERIFF_DECISION
onboardingId= sessionId= status= code= reasonCode=` — never the free-text `reason` or the `person`.
The mapping is on `status`, never on the numeric `code`:

| Decision `status`        | `code` | Verdict                                                                                                                                                                |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `review`                 | 9121   | `pending`                                                                                                                                                              |
| `approved`               | 9001   | `approved({lastName, dateOfBirth})` from the decision's `person`                                                                                                       |
| `declined`               | 9102   | `declined([reasonCode], reason)`                                                                                                                                       |
| `resubmission_requested` | 9103   | `resubmission(target, limitExceeded, [reasonCode], reason)` — `SELFIE` for reason codes 202, 208 and 214, else `IDENTITY`; `limitExceeded` when the reason code is 539 |
| `expired`, `abandoned`   | 9104   | `resubmission(IDENTITY)` with no reason; should not occur in API-only mode, where the session is submitted inside the same `execute`                                   |
| any other                |        | throws `VeriffDecisionUnrecognisedStateError` (status and code only, never the free text)                                                                              |

The `code` column follows Veriff's status-codes table
(devdocs.veriff.com/docs/verification-session-status-codes-table), which gives 9104 to both
`expired` and `abandoned` and 9121 to `review`; the `GET /v1/sessions/{id}/decision` reference
(devdocs.veriff.com/apidocs/v1sessionsiddecision-1) instead gives 9104 to `expired` and 9121 to
`abandoned`. That disagreement is why the mapping keys on `status` and the codes are logged only
(`VERIFF_DECISION_CODE_*` in `veriff-contract.ts`).

Veriff reports no attempt count, so the kernel counts: every `resubmission` — `expired` and
`abandoned` included — adds one to `kycAttemptCount` and is capped at `maxAttemptsPerDocSet` as total
resubmissions per onboarding. Face reason codes 201 and 217 are not mapped to `SELFIE` today.

Credentials: `apiKey` (required, not secret) and `sharedSecretKey` (secret, required), configured
through `/v1/admin/connectors/veriff_kyc`, so the admin panel's Connectors page shows the card
without panel code. **One secret signs both directions.** `callbackAuth` is HMAC-SHA256, hex, header
`x-hmac-signature`, with `secretSettingKey: 'sharedSecretKey'` so the signature verifier reads that
key rather than `callbackSigningSecret` (§5). Store the shared secret of the key pair Veriff marks
as the integration's **master signature key**: Veriff accepts any of an integration's secrets on API
calls but signs every webhook with the master one, so a non-master secret passes every outbound call
while each webhook is refused with `signature_mismatch` (found in the first manual run, 2026-10-05).
A rotation window is a comma-separated list: the first
entry signs outbound calls, every entry verifies inbound ones, so a secret containing a comma cannot
be stored. `VERIFF_BASE_URL` and `VERIFF_TIMEOUT_MS` are deployment settings (§10). Veriff uses one
host for test and live; the API key decides the mode. Any failure reaching Veriff, a non-2xx, or a
body it cannot read is `500 VERIFF_UNAVAILABLE` (§11).

**What a test integration requires.** A Veriff TEST integration never decides on its own: the
decision is forced in the Veriff Customer Portal, which then fires the decision webhook. Point both
the decision webhook URL and the event webhook URL at `<public host>/v1/webhooks/veriff_kyc/callback`,
and store the integration's `apiKey` and shared secret as above; sample images of any size work,
since `VeriffMediaFitter` brings them within Veriff's 1920 px longer-side limit before upload.
`scripts/run-eu-b2c-kyc-manual-test-veriff.sh` drives the Veriff walkthrough end to end against
`eu-b2c-individual-kyc-eea-veriff-v2-local` and stops at the one step only the Portal can perform.

---

## 5. Async provider callbacks

`POST /v1/webhooks/:providerKey/callback`, where `providerKey` resolves against the adapter's
own `id` (`WebhookService.findAdapter` calls `ConnectorExecutionPort.findAdapterById`), not its
`type` — `type` is a shared capability (`smtp` and `sendgrid_email` are both `email_delivery`;
`sumsub_kyc` is `kyc`) and cannot address one adapter. Full contract:
`packages/engine/docs/connector-callback-signatures.md`.

The request path is ordered so that nothing happens before authentication:

1. `main.ts` installs a **raw** body parser for `/v1/webhooks/*` and JSON/urlencoded parsers
   everywhere else. The signature must be computed over the exact bytes the provider signed; a
   request that reaches the controller without one is refused `400 ASYNC_CALLBACK_RAW_BODY_REQUIRED`.
2. Resolve the adapter by `providerKey`: refused `400 ASYNC_CALLBACK_PROVIDER_KEY_INVALID` unless it
   matches `^[a-z0-9_]+$`, and `400 ASYNC_CALLBACK_AUTHENTICATION_FAILED` when no callback-capable
   adapter carries that id. All three are exception classes in `webhook/errors/`, like every other
   client-facing refusal (§11).
3. `CallbackSignatureVerifier.verify(adapter, {rawBody, headers})`.
4. Only then `adapter.mapCallbackResult(...)` parses the payload and correlates it to an
   onboarding.
5. `OnboardingsService.submit(onboardingId, submittedData, { providerIdentity, origin:
'provider_callback', resolvedConnector })` replays the normal submit path with `resume`;
   `resolvedConnector` carries the `pendingConnector` the adapter correlated against, which the
   submit path re-checks under the row lock (§3, step 6).

Responsibility is split: **the adapter declares the recipe** (header names, `sha256`/`sha512`,
`hex`/`base64`, optional epoch-seconds timestamp header with a tolerance window, optional
`parseSignatureHeader` for rotation-style packed headers, optional `buildSignedMessage`); **the
engine executes the check** — secret lookup, timing-safe comparison with no early exit across
rotation secrets, replay bounding, and failure classification.

Secrets come from the adapter's own settings, resolved through
`ConnectorSettingsService` on every callback like any other connector credential (§4,
[0006](./decisions/0006-callback-signing-secret-in-connector-settings.md)). The key defaults to
`callbackSigningSecret`; an adapter whose provider signs both directions with one secret names the
key in `callbackAuth.secretSettingKey` instead — `veriff_kyc` names `sharedSecretKey`, so there is
no second secret to store. `CallbackSignatureVerifier` reads whichever key the adapter names and
nothing else. A provider-side rotation window is a comma-separated list in that one value, and every
entry is tried (an adapter signing outbound with the same secret uses the first); a secret
containing a comma therefore cannot be stored. A signed connector with no stored secret rejects at
request time rather than failing startup — _reasoning:_ a missing secret for one provider must not
take the whole engine down. Because the value is a declared `settingsSchema` field, that gap is
also visible on `GET /v1/admin/connectors` rather than only in an audit record.

Providers that genuinely do not sign declare `callbackAuth: {kind: 'none', justification: '…'}`.
That declaration is required (asserted at startup) but not sufficient: in production such a
connector's callbacks are accepted only if its id is listed in
`CONNECTOR_CALLBACK_UNSIGNED_TYPES`. Outside production they are accepted by default so local and
CI runs work. _Reasoning:_ registering an adapter is not the same as using it, so the code
invariant ("state your posture") and the deployment decision ("this instance accepts unsigned
ingress from X") are separated.

Every failure answers the identical opaque body `{code, message}: ASYNC_CALLBACK_SIGNATURE_INVALID`,
but not always the same HTTP status. `CallbackSignatureInvalidException` selects `503` for the two
reasons that describe the engine's own configuration gap — `callback_auth_not_declared` and
`signing_secret_missing` — and `401` for the other six, which describe the caller
(`signature_mismatch`, `timestamp_out_of_tolerance`, …). _Reasoning:_ Sumsub (and providers with the
same policy) treat `401` as permanent and never redeliver, so answering `401` to our own
configuration gap would destroy a verdict landing inside it with no retry to recover it; `503` is
honest about being unable to verify anything right now and keeps the provider's retry budget alive
until the gap closes. The distinguishing reason itself still never reaches the caller — only the
`webhook.inbound_callback_rejected` audit record.

**The parked connector is persisted.** When a step parks, the next state carries
`pendingConnector` — `{connectorId, connectorName, connectorOrder, providerReference?, parkedAt?}`,
the connector that initiated the work, the reference the adapter's accepted result returned, and
the instant the submit path first wrote the park (§3, step 8; a re-park keeps it) — and
`onboardings.pending_connector` (§9) stores it. Every other transition sets it to `null`. An
operator may switch the step's connector while an onboarding waits (§2), so
`AwaitingCallbackConnectorResolver.findConnector` answers from the record and from nothing else:

1. Load the onboarding and its effective workflow, as before; an unknown, approved or completed
   onboarding, or one with no current step, or whose step is gone, resolves to `undefined`.
2. If `pendingConnector` is `null`, log `AWAITING_CALLBACK_PARK_NOT_RECORDED` at warn and resolve
   to `undefined`. There is no fallback to the step's chain any more: a row on the step without a
   park is one a retry verdict has cleared and the client has not resubmitted, and a late decision
   for an attempt it no longer waits on must not decide it.
3. Otherwise the callback's connector id must equal `pendingConnector.connectorId`, else
   `undefined`. The slot is the step's declaration with `order === connectorOrder` (`undefined` if
   none). The connector is the link of `[slot, ...slot.fallbacks]` carrying the parked id or, when
   the operator has since switched the primary and that id is no longer in the chain, the slot with
   its `id` replaced by the parked id — its authored config and field mapping are provider-neutral
   and stand in.

The resolution carries the record (`pendingConnector`, never `null`) so the KYC kernel can compare
provider references before it fetches a verdict (§4), and the adapter's callback result carries it
on to the submit path, which compares it with the row it locks (`OnboardingEntity.isParkedOn`, §3
step 6) — the resolver's own read is unlocked, so that second check is what makes the comparison
hold at the moment the result is applied. So an onboarding parked on the previous provider finishes
with it, its callback arriving at that adapter's own `/v1/webhooks/<id>/callback`, while one started
after the switch parks on the new provider. `providerReference` is plain data on the onboarding
row, not encrypted, so the resolver reads it without the encryption port; it is never exposed by the
admin API.

Two kinds of callback are acknowledged rather than applied, and neither is an error:

- A callback whose resolved connector no longer matches an onboarding still awaiting it —
  typically because an earlier delivery already applied its verdict: an adapter's
  `mapCallbackResult` throws `ConnectorCallbackAlreadyAppliedError` (the KYC connectors do, through
  `AwaitingCallbackConnectorResolver`, as they do for an `onboardingId` that is not a UUID — §4),
  `WebhookController` catches it, records `webhook.inbound_callback_rejected` with reason
  `callback_already_applied`, and answers the route's ordinary `204` rather than the
  `400 INVALID_STEP_DATA` a stale redelivery produced before. That is the redelivery guard: a
  provider's retried delivery of an already-applied verdict is acknowledged once, not reapplied.
- A callback decided for a park the locked row no longer holds — a client submit or a switch
  landed between the adapter's read and the lock: the submit path throws
  `ConnectorCallbackSupersededError`, `WebhookController` records
  `webhook.inbound_callback_rejected` with reason `callback_superseded`, and answers `204`. Nothing
  is written to the onboarding and no client notification goes out; the newer attempt's own
  callback decides it. The route's `@ApiNoContentResponse` names all three meanings of its `204`.

### Stuck onboardings: the operator reconcile

Nothing in the engine wakes a parked onboarding on its own: `expiresAt` is never set, manual review
applies only `manual.*` arms (and the KYC step declares none), and a callback that never arrives
leaves the row parked indefinitely. `POST /v1/onboardings/{id}/pending-connector/reconcile`
(`@AdminRoute()`, `200`, operation `reconcileOnboardingPendingConnector`,
`PendingConnectorReconcileService`) is the operator's answer: ask the parked connector's adapter
for the verdict the provider holds, and apply it as the callback would have been applied.

1. Load the onboarding (`404 ONBOARDING_NOT_FOUND`); a row with no park is refused
   `409 ONBOARDING_NOT_AWAITING_CONNECTOR`.
2. Find the park's adapter through `ConnectorExecutionPort.findAdapterById`. The port method is
   optional — `ConnectorAdapter.reconcilePending?(input: { onboardingId })` — because a provider
   with no read-back cannot offer it; an adapter that is missing or lacks the method is refused
   `409 PENDING_CONNECTOR_RECONCILE_UNSUPPORTED` with `connectorId` and `reason: 'adapter'`. The
   KYC kernel implements it (§4) and refuses with `reason: 'reference_missing'` when the park
   records no `providerReference` to read. `mock_async_callback` implements it too, answering
   whatever a test set with `setReconcileOutcome` (`still_pending` until set).
3. The adapter answers `{ outcome: 'still_pending' }` or `{ outcome: 'resolved', callback }`
   (`ConnectorReconcileResult`). `still_pending` changes nothing. `resolved` goes through
   `OnboardingsService.submit(id, callback.submittedData, { providerIdentity, origin:
'admin_reconcile', operatorId, resolvedConnector })` — the same path as a callback, so the row
   lock, the completed guard and the park re-check all apply; the client webhook is notified as for
   any transition.

The response (`ReconcilePendingConnectorResponseDto`) is `{ outcome, onboarding }`, where
`outcome` is `applied` (the verdict moved the onboarding), `still_pending` (the provider has not
decided) or `superseded` (the onboarding left that park between the read and the apply — the
submit path's `ConnectorCallbackSupersededError`, or the adapter's own
`ConnectorCallbackAlreadyAppliedError`), and `onboarding` is the admin summary as it now stands.
Every outcome leaves an audit row under the operator who asked (§8): `applied` writes
`onboarding.pending_connector_reconciled` from inside the submit transaction; the two no-ops write
`onboarding.pending_connector_reconcile_noop` with the outcome. The service logs
`PENDING_CONNECTOR_RECONCILED` on an apply.

Finding the rows to reconcile is the list's job: `GET /v1/onboardings` filters on `parked`
(`true` / `false`, whether `pending_connector` is set), `pendingConnectorId` and `parkedBefore`
(ISO-8601, compared with the record's `parkedAt`), and every admin summary's `pendingConnector`
carries `parkedAt` (`null` for a row parked before the engine recorded it — which `parkedBefore`
therefore never matches). There is no scheduler: the route is the manual form of the reconciliation
a worker-role poller over `parkedAt` would run, and that poller is the recorded follow-up
([0039](./decisions/0039-parked-onboarding-lifecycle.md)). The other recorded gap is on the client
side: `GET /v1/onboardings/{id}/state` does not yet say the onboarding is parked, so the
`409 ONBOARDING_AWAITING_CONNECTOR` on submit (§3) is the only signal a BFF gets.

**Documented limits** (verbatim from the connector-callback doc, still true): the callback URL is
guessable so the signature is the only barrier; secrets are keyed by connector _id_, which is right
for a dedicated adapter like `sumsub_kyc` or `veriff_kyc` but wrong for a generic connector and blocks
`async: true` on `http_request` until a per-initiation callback token exists; there is no replay
dedupe inside the timestamp window; HMAC only; epoch seconds only.

---

## 6. Outbound client webhooks

`packages/engine/src/webhook/`.

A workflow declares one root target: `"webhook": { "notify": { "path": "notify" } }`. The path is
resolved against `CLIENT_WEBHOOK_BASE_URL` (validated at startup: absolute, no credentials, no
fragment, HTTPS in production, HTTP only for loopback outside production). Leaving the base URL
empty disables outbound webhooks entirely. An individual transition can opt out with
`"webhook": { "notify": false }`.

Two event types exist. `WebhookEventPayload` is a union discriminated on `event.type`; every
outbox row holds exactly one arm.

- **`onboarding.state_changed`** — payload `version: 1`, carrying event id/type/timestamp and
  `{id, workflowId, workflowVersion, status, currentStep, completedAt}`. Unchanged by the agreement
  work: it is one arm of the union now, and its own fields are the same.
- **`onboarding.agreement_pending`** — payload `version: 1`, carrying the same event envelope, an
  `onboarding` block of `{id, workflowId, workflowVersion, status}`, and an `agreement` block of
  `{id, key, type, version, previousAcceptedVersion}`. It carries no `currentStep` or `completedAt`:
  nothing about the onboarding's position in its workflow changed, only what it owes, so the
  lifecycle fields would be noise a consumer could mistake for a transition.
  `previousAcceptedVersion` is the highest version of the same family the onboarding had already
  accepted, or `null` — enough to tell a first agreement from a re-consent without querying back.

**`onboarding.agreement_pending` has exactly one trigger: a link created out of the flow the user is
walking.** That is `POST /v1/onboardings/:id/agreements`, and the fan-out a publish performs —
publishing emits no event of its own, it notifies only because it is a bulk linker, one event per
link it created. The links `OnboardingsService.start` writes are deliberately silent: those families
are collected by the workflow step itself, the client already renders them from the `/state`
descriptor, and `onboarding.state_changed` fires for the creation anyway. The event is enqueued only
after the transaction that created the link commits, because an outbox row surviving a rolled-back
link would announce an agreement nobody owes.

The outbox schema did not change for it. `onboarding_id` stays `NOT NULL` and the endpoint comes
from that onboarding's own workflow root `notify.path`, resolved through
`Workflow.getRootNotifyWebhook()`; a workflow declaring no notify webhook suppresses the event and
logs it, the same as every other notification.

_Reasoning for the reduction:_ the spec had per-transition webhooks with arbitrary `data`
selections, a required `systemWebhooks` block, and an event catalogue. In practice every consumer
wanted the same thing — "this onboarding moved" — and per-transition payload selection would have
put PII routing decisions into workflow JSON. One fixed lifecycle envelope with per-transition
_suppression_ covers the observed need and keeps payload contents out of the DDL author's hands.

### The outbox

Table `client_webhook_outbox`, states `PENDING → SENDING → DELIVERED | ERROR`, with per-row retry
policy columns (`max_attempts` 5, `base_delay_ms` 5000, `backoff_multiplier` 2, `max_backoff_ms` 300000) and `next_delivery_at` / `sending_started_at`.

Delivery is **non-blocking**: the state transition commits first, then the intent row is written
and a BullMQ job is enqueued. _Reasoning:_ the spec wanted the transition to park in
`awaiting_webhook_ack` until a `2xx`. That couples the onboarding's progress to a third party's
uptime and makes every consumer outage a user-visible stall. The outbox gives the same
at-least-once guarantee without holding the state machine hostage. The cost — ordering across
events is not guaranteed and a client may observe a state before its notification — is accepted;
the payload carries the full state, so a late event is still self-describing.

The one delivery path that actually runs is `WebhookQueueService` → `HttpDeliveryService.deliverDue`.
`WebhookService` also carries a private `deliver`/`deliverHttp` pair with near-identical logic, but
nothing calls it — `resend` enqueues onto the queue like everything else, so those two methods are
unreachable. Read `HttpDeliveryService` for live behaviour; only it sets the `X-Webhook-Event-Id`
request header.

Claiming is a single conditional `UPDATE … WHERE status = 'PENDING' … RETURNING *`, incrementing
`attempts` and stamping `sending_started_at`, with `deliverDue` additionally requiring
`next_delivery_at <= now` and `attempts < max_attempts`. That is the mutual exclusion: two workers
cannot both claim a row. On failure `finalizeFailedClaimFromSending` either schedules the next
attempt with exponential backoff or terminalizes to `ERROR` once `attempts >= max_attempts`.

Two mechanisms drive work:

- **`WebhookQueueService`** — BullMQ over Redis, jobs are pure wake-ups (`{outboxId}`, `attempts: 1`).
  Retries are _not_ delegated to BullMQ; the database row is the source of truth.
- **`RetryService`** — a poller (default 1s) that (a) expires stale `SENDING` leases older than
  `WEBHOOK_OUTBOX_WORKER_LEASE_MS`, terminalizing them to `ERROR`, and (b) enqueues due `PENDING`
  rows in batches, at most 5 concurrent enqueues.

`WEBHOOK_OUTBOX_WORKER_LEASE_MS` is validated to be at least `CLIENT_WEBHOOK_TIMEOUT_MS + 5000`, so
a delivery still in flight is never reclaimed underneath itself.

_Reasoning for DB-as-truth over BullMQ retry:_ BullMQ retry state is invisible to operators, is
lost if Redis is flushed, and cannot be queried alongside the onboarding it belongs to. Keeping
schedule and attempt count in Postgres means Redis is a wake-up channel that can be rebuilt from
the table at any time.

`WebhookService.notifyError` covers the failure path: when a submit throws, the onboarding is
notified using the **pre-mutation snapshot**, so a consumer is not told about a state that was
rolled back.

### Modes

`MODE` = `all` | `api-only` | `worker-only`. The queue consumer and the retry poller start only
when the mode is not `api-only`; migrations run only when the mode is not `worker-only`. Compose
pins the `engine` service to `api-only` and `engine-worker` to `worker-only` precisely so that
migrations and polling each have exactly one owner.

---

## 7. Documents and object storage

```
POST /v1/onboardings/:id/documents                       → reserve
  (client PUTs/POSTs directly to storage using the returned presigned POST form)
POST /v1/onboardings/:id/documents/:documentId/complete   → verify and promote
```

The engine never proxies file bytes. `reserveDocumentUpload` locks the onboarding, checks the
requested field is _the_ active `file` field of the current step, checks the declared content type
and size against the field's `validation`, issues a presigned POST form for a **staging** key
(`onboardings/<id>/<docId>/staged`, 300s TTL), and records a `pending` row. A live pending
reservation for the same step/field is a `409`; an expired one is deleted from storage and marked
`expired` before a new one is issued.

`completeDocumentUpload` is where trust is established. It reads the staged object back and:

- verifies the **actual** byte size equals the reserved size,
- **sniffs** the MIME type from the bytes (`file-type`) and requires it to equal both the requested
  content type and one of the field's allowed types,
- checks image dimensions (`image-size`) against `maxImageWidth` / `maxImageHeight` when declared,
- promotes staging → final with an `If-Match` on the inspected ETag, then marks the row `completed`.

If persistence fails after promotion, the promoted object is deleted best-effort.

_Reasoning:_ a presigned upload means the client tells storage what it is uploading, and a
client-declared `Content-Type` is not evidence. Re-inspecting server-side after the fact is what
makes the workflow's `contentTypes` constraint actually enforceable. The staging/final split exists
so that an unverified object never occupies the key a connector reads from, and the ETag
precondition ensures the bytes inspected are the bytes promoted.

`ObjectStoragePort` (`issueUploadTicket`, `inspectStagedObject`, `readObject`,
`promoteInspectedObject`, `deleteStagedObject`) has one implementation, `S3ObjectStorageService`
(AWS SDK v3, path-style, endpoint-agnostic — Garage locally and in CI, any S3-compatible store in
production). `STORAGE_DRIVER` is an enum with a single value `s3` — the seam exists, alternatives
do not.

The local store's enforcement of the presigned POST policy is verified, not assumed: a POST that
exceeds the declared size or declares a mismatched `Content-Type` is rejected with `400` before the
object is ever written, so a workflow's `contentTypes`/size validation is backed by the store
itself and not only by the server-side re-inspection above.

---

## 8. Audit log

`packages/engine/src/audit/`, contract in `packages/engine/docs/audit-log-contract.md`.
Read API: `GET /v1/admin/audit` with filters (`actorType`, `actorId`, `action`, `resourceType`,
`resourceId`, `occurredFrom`/`occurredTo` as strict ISO-8601) and pagination (default 20, max 100).

Two reliability tiers, stated explicitly in the contract:

- **Atomic** — lifecycle records (`onboarding.started`, `onboarding.state_transition`,
  `onboarding.manual_review_decision`) and outbox state records are written in the same transaction
  as the change they describe. Either both persist or neither does.
- **Best effort** — inbound receipt/rejection/mapping observations and resend records. If the audit
  write fails, the engine's behaviour is unchanged.

Actions are a closed set (`audit.types.ts`) and every write goes through an allowlist:
`REJECTED_ATTEMPT_OUTCOME_ALLOWLIST` maps operation → permitted outcomes, and
`WEBHOOK_RESOURCE_ALLOWLIST` maps webhook action → permitted resource types. A mismatch throws.
_Reasoning:_ the audit log's value is that its vocabulary is fixed; an allowlist makes an
unreviewed action name a test failure rather than a new row shape in production.

`AuditLifecycleMetadata` carries `fromScores` / `toScores` (`null` `fromScores` on
`onboarding.started`, since there is no prior state), filled from the onboarding's `scores` column
and passed through `filterLifecycleMetadata` like every other lifecycle field. This is what puts an
engine-initiated score change in the audit trail rather than only in the application log.

A credential write on `/v1/admin/connectors` (§4) records `connector_settings.updated` on a `PUT` or
a `PATCH`, or `connector_settings.deleted` on a `DELETE`, filed under resource type
`connector_settings`
with `resourceId` the connector id. Both go through the same closed-set allowlist as every other
action family (`CONNECTOR_SETTINGS_ACTIONS`, asserted by `assertConnectorSettingsChangeAllowed`).
Metadata (`ConnectorSettingsAuditMetadata`) carries `connectorId` and `keys` — the setting **key
names** touched by the write — and nothing else: never a value, masked or otherwise, and never the
previous value. That is a deliberate guarantee, not an implementation detail — a credential must
not be reconstructible from the audit trail.

A runtime connector selection (§2) records `workflow.connector_selected` on a `PUT` and
`workflow.connector_selection_cleared` on a `DELETE` of `/v1/admin/workflows/:workflowId/steps/:stepName/connector`,
both with entry type `success`, filed under resource type `workflow` with `resourceId` the workflow
key, one row per write, after the database commit. A `DELETE` is audited even when no selection
existed. Metadata carries `workflowId`, `stepName`, `connectorId` (`null` on a clear), `scope` and
`versions: [{ version, previousConnectorId }]` — ids and names, no configuration — and goes through
the same allowlist as the other families. The allowlist still keeps a top-level
`previousConnectorId`, so rows written before selections were per version read back.

An operator reconcile of a parked onboarding (§5) writes one of two actions
(`PENDING_CONNECTOR_ACTIONS`, `AuditService.logPendingConnectorReconcile`), both with actor type
`operator` — the operator id from the admin token, or the unknown-actor placeholder when the claims
carry none — filed under resource type `onboarding` with `resourceId` the onboarding id:

| Action                                        | Entry type | Written when                                                                                                                                                                                                                                           |
| --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `onboarding.pending_connector_reconciled`     | `success`  | The verdict read back was applied, inside the submit transaction, in place of the `webhook.inbound_callback_applied` row a callback writes. Metadata: `connectorId`, `connectorOrder`, `providerIdentity`, `submittedData`, `connectorExecutionResult` |
| `onboarding.pending_connector_reconcile_noop` | `observed` | The ask changed nothing. Metadata: `connectorId`, `connectorOrder`, `outcome` (`still_pending` \| `superseded`)                                                                                                                                        |

The applied row keeps the same sensitive-data exception as `webhook.inbound_callback_applied`
(below) for the same reason, and a reader tells the two apart by action alone. The refusals around
it land elsewhere: a client submit refused because the row is parked is an
`onboarding.rejected_attempt` with outcome `awaiting_connector` (`REJECTED_ATTEMPT_OUTCOME_ALLOWLIST`,
`submit` only), and a callback dropped because the locked row no longer holds the park it was decided
for is a `webhook.inbound_callback_rejected` with reason `callback_superseded` (§5), beside
`callback_already_applied`.
An export through `GET /v1/onboardings/export` records `onboardings.exported`, actor type
`operator`, resource type `onboardings_export` and resource id `onboardings`, written once the columns have resolved and
before the first byte of the file; an export that fails earlier writes no such row. Metadata (`OnboardingsExportAuditMetadata`) is only the filter criteria the
request supplied — `status`, `workflowId`, `workflowVersion`, `currentStep`, `onboardingId`,
`agreementStatus`, `parked`, `pendingConnectorId`, `parkedBefore` — and never a row of exported data. An empty actor id becomes
`ADMIN_ACCESS_UNKNOWN_ACTOR`. The action is in `ONBOARDINGS_EXPORT_ACTIONS`
(`audit/audit.types.ts`). Today, apart from the `api.*` rows for failed admin requests, it is the
only trace of an admin read.

The agreement feature (§2, §9) adds three actions, allowlisted the same way
(`AGREEMENT_RESOURCE_ALLOWLIST`, `filterAgreementMetadata`), and every one of them is written in the
same transaction as the change it describes:

| Action                        | Resource type | Written when                                                                                                                              |
| ----------------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `agreement.version_published` | `agreement`   | A publish succeeds — the only action filed against the `agreement` resource type. Metadata: `key`, `type`, `version`, `linkedOnboardings` |
| `agreement.linked`            | `onboarding`  | Any link is created. Metadata: `agreementId`, `key`, `version`, `origin` (`onboarding_start` \| `version_published` \| `manual`)          |
| `agreement.accepted`          | `onboarding`  | A link is recorded as accepted. Metadata: `agreementId`, `key`, `version`, `origin` (`step_submit` \| `manual`)                           |

Only the publish names an actor; a link and an acceptance are written by the engine as it carries
out a flow, so neither carries one. _Reasoning:_ two of the three record work the engine started on
its own — the links written at onboarding start, and the publish fan-out that links onboardings the
operator never named individually — which is exactly why they are audit rows rather than log lines.
Metadata carries the agreement's identity and version and nothing of its content.

Workflow drafts add `workflow_draft.created`, `workflow_draft.updated`, `workflow_draft.deleted` and
`workflow_draft.published`, written through `AuditService.logWorkflowDraft` in the same transaction as the write. The resource is
the `workflow_version` row's id. Metadata is limited to `workflowId` and `version`, plus
`previousWorkflowId` and `previousVersion` on a rename; the document is never logged, because
connector `config` may hold literal values.

Data boundaries are deliberate and documented rather than incidental:

- Inbound observations exclude raw bodies, headers, signatures, credentials, endpoint URLs,
  response/error bodies and exception text.
- `webhook.inbound_callback_applied` **does** retain the applied submitted data and connector
  result — a declared sensitive-data exception, because reconstructing a provider-driven state
  change otherwise is impossible.
- Outbound payloads **are** retained in full on intent/attempt/success/failure records — also
  declared, not accidental.

Non-guarantees are equally explicit: the log is **not** hash-chained. The `hash_prev` / `hash_self`
columns exist and are always written as `null`. _Reasoning:_ the columns preserve the option
without pretending the property holds; claiming tamper-evidence that is not implemented would be
worse than not having it.

### Non-success outcomes: the `api.*` family and its neighbours

Every 4xx/5xx response on `/v1` and every internal failure that never reaches HTTP now leaves a
row, on the **best-effort** tier: own transaction, fire-and-forget, a failed write never changes
engine or HTTP behaviour.

`api.request_rejected` (status 400–499) and `api.request_failed` (status >= 500), resource type
`api_endpoint`, are written by `ApiFailureAuditFilter` — a global `APP_FILTER` — for every
unsuppressed exception on the `/v1` surface (§11). The one failure the filter's `catch` never sees,
an error in the CSV export's stream, is recorded by the export's error handler through the filter's
`recordFailure`. A throw site that already wrote its own
domain-specific row marks the exception so the filter stays silent; `auth.*` denials are the one
deliberate exception and write both rows, because the guard's audit write is fire-and-forget and
suppressing on an unattempted write could leave a denial with no evidence at all. `resourceId` is the matched route template
(`POST /v1/onboardings/:id/documents`), or the raw request path when Nest matched no route.
`ApiFailureAuditMetadata` carries `method`, `route`, `status`, `code` (the exception's fixed
contract code, when it has one), `errorName` (the exception class name, never its message),
optional `routeParams`, and optional `fieldErrors` (constraint keys or reason codes, never
values). Writes are scheduled through a bounded pending set
(`MAX_PENDING_API_FAILURE_AUDITS = 8`, `packages/engine/src/audit/api-failure-audit.filter.ts`)
deliberately set below the Postgres pool's default of 10 connections rather than mirroring the
connector family's 100 — `/v1` 4xx responses are anonymous-reachable, unlike a connector failure
which needs an authenticated submit,
dropped past the cap with `logger.error`, and flushed on shutdown — the same back-pressure pattern
`workflow-connector-executor.service.ts`'s connector-failure audits already use, so an
unauthenticated caller flooding `/v1/*` cannot turn one request into one unbounded audit insert.

`webhook.*` gained eight actions for paths a BullMQ job, poll loop or lease sweep can fail on
without ever producing an HTTP response: `webhook.inbound_signature_skipped`,
`webhook.outbound_notification_dropped`, `webhook.outbound_intent_failed`,
`webhook.outbound_lease_expired`, `webhook.outbound_poll_failed`,
`webhook.outbound_dispatch_failed`, `webhook.outbound_queue_job_failed`, and
`webhook.outbound_finalization_noop`, filed under `onboarding`
(`webhook.outbound_intent_failed`, `webhook.outbound_notification_dropped`) or
`client_webhook_outbox` (the other six) per `WEBHOOK_RESOURCE_ALLOWLIST`.
`webhook.outbound_notification_suppressed` was declared and allowlisted before this change but
never actually written; it is now written when a suppressed outbound notification is dropped. Its
`operation` names which arm suppressed it — `notify`, `notify_error` or
`notify_agreement_pending` — and its `eventType` is the event that went undelivered, so an
agreement notification dropped for want of a configured webhook is as visible as a lifecycle one.

`connector.*` gained three actions for failures that occur before the connector handler chain
runs, so no `attempt` or `errorHandler` exists to name: `connector.execution_unavailable`
(pre-chain executor failure), `connector.result_rejected` and `connector.result_invalid_data`
(non-throwing connector refusals). These do not reuse `ConnectorFailureAuditMetadata` — a
pre-chain failure has no honest value for its `attempt`/`errorHandler` fields — but instead carry
their own `ConnectorOutcomeAuditMetadata` (`stepName`, `connectorId`, `connectorName`, optional
`connectorOrder`, optional `reason`, optional `fieldErrors`) checked against a separate
`CONNECTOR_OUTCOME_ACTIONS` allowlist, both in `audit.service.ts`, written by
`AuditService.logConnectorOutcome`.

---

## 9. Persistence

Postgres via TypeORM, `synchronize: false`, migrations run at boot (unless `worker-only`). UUIDv7
primary keys everywhere (`generateUuidV7`) so ids sort chronologically and index locality is good.

`workflows` and `agreements` are each split into an identity row and the version rows beneath it,
so a version is a row rather than half of a composite key — decision record
[0028](decisions/0028-identity-and-version-tables.md) has the reasoning.

| Table                           | Purpose                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboardings`                   | id, `workflow_version_id` (the only workflow reference), status, current_step, `context` jsonb, `scores` jsonb, `pending_connector` jsonb (nullable, plain — the connector the onboarding is parked on awaiting a callback, §5), expires_at, completed_at, rejection_reason, timestamps                                                                                                                 |
| `onboarding_documents`          | reservation lifecycle: staging/final keys, requested vs verified content type/size/etag, expiry                                                                                                                                                                                                                                                                                                         |
| `client_webhook_outbox`         | delivery state, payload, endpoint, retry policy, lease                                                                                                                                                                                                                                                                                                                                                  |
| `audit_log`                     | occurred_at, actor, action, entry_type, resource, before/after jsonb, metadata jsonb, unused hash columns                                                                                                                                                                                                                                                                                               |
| `otp_challenges`                | one live code per `(onboarding_id, channel)` (`UNIQUE`): `code_hash` (hex SHA-256 of salt and code — never the code), `code_salt`, `expires_at`, `attempts`, `send_count`, timestamps; `onboarding_id` FK `fk_otp_challenges_onboarding` `ON DELETE CASCADE`                                                                                                                                            |
| `connectors`                    | `id` primary key, `type` (the class it belongs to), `settings jsonb` (plaintext — confidentiality at rest is the database's), `updated_at`, `updated_by`                                                                                                                                                                                                                                                |
| `workflows`                     | the identity row: uuid `workflow_id` primary key, `key` unique (the document's `id`), nullable `name` (the root `name` of the highest stored version that declares one), `scope` (`built-in` \| `fixtures` \| `users`, fixed by the file that created the family), timestamps. No `version`, `status` or `definition` — those live below                                                                |
| `workflow_versions`             | one row per revision: uuid `workflow_version_id` primary key, `workflow_id` FK, `version`, `status` (default `published`), `definition` json, timestamps; `UNIQUE (workflow_id, version)`                                                                                                                                                                                                               |
| `workflow_connector_selections` | the operator's connector choice per workflow version and step: composite PK `(workflow_id, version, step_name)`, `version` checked `> 0`, `workflow_id` FK to `workflows` (`ON DELETE CASCADE`, `fk_workflow_connector_selections_workflow`), `connector_id` (checked against `^[a-z0-9_]+$`), `updated_at`, `updated_by`. `step_name` is not a foreign key — it names a step inside the versions' JSON |
| `agreements`                    | the family row: uuid `id` primary key, nullable `workflow_id` FK (declared, unpopulated — see below), `key` unique, `type`, `current_version_id` FK, `created_at`. No `name`                                                                                                                                                                                                                            |
| `agreement_versions`            | one row per published version: uuid `agreement_version_id` primary key, `agreement_id` FK, `version`, `published_at`, `created_at`; `UNIQUE (agreement_id, version)`                                                                                                                                                                                                                                    |
| `onboarding_agreements`         | the links: composite PK `(onboarding_id, agreement_version_id)`, `status` (`pending` \| `accepted`), `accepted_at`, `created_at`                                                                                                                                                                                                                                                                        |
| `encryption_keys`               | history of data keys that have wrapped `onboardings.context`: `id`, `wrapped_key`, `created_at`, `created_by`, `activated_at`, `deleted_at`, `rotation_interval` — `deleted_at IS NULL` marks the single active key, enforced by a partial unique index, and carries the automatic-rotation schedule                                                                                                    |
| `_engine_alive`                 | trivial table from `0001_initial_schema` proving migrations run                                                                                                                                                                                                                                                                                                                                         |

Only `agreements` carries a `current_version_id`. An agreement version is created only by
`POST /v1/admin/agreements`, which sets the pointer in the same statement that writes the version,
so it can never go stale. `workflows` has no equivalent column: a workflow revision's `status` is
edited directly in Postgres — by the admin UI, or an operator by hand — and must take effect on the
next request rather than the next boot, so a workflow's current revision is still resolved the way
it always was, by querying `workflow_versions` for the highest `published` version (unpinned) or a
specific pinned one, never by following a stored pointer.

`agreements.workflow_id` exists, is nullable, carries `fk_agreements_workflow`
(`ON DELETE SET NULL`), and is **null on every row** — nothing populates it yet. Scoping an
agreement family to one workflow needs a new field on `PublishAgreementRequestDto`, which would
change the HTTP contract, so it is left declared and unused rather than half-built.

One view, `onboarding_agreement_statuses`, sits over `agreements`, `agreement_versions` and
`onboarding_agreements`: it reports
`(onboarding_id, agreement_status)` with `agreement_status` one of `current` / `outdated` /
`not_accepted`, computed per family — grouped by `agreement_id`, not `key` — from the link rows and
then aggregated over the onboarding — `not_accepted` if any family has no accepted version,
`outdated` if every family has one but at least one is behind the family's latest, `current`
otherwise. An onboarding with no links at all does not appear in the view, and every reader
coalesces that absence to `not_accepted`. It is created by the migration and mapped as a
TypeORM `@ViewEntity`, never generated — `synchronize: false` is global. The `onboardings` table
gained no column for it, and the reasoning is in decision record
[0013](decisions/0013-versioned-agreements.md).

`onboarding_agreements` carries three constraints worth knowing: the onboarding foreign key is
`ON DELETE CASCADE` (a deleted onboarding's links go with it) while the agreement-version foreign
key is `ON DELETE RESTRICT` (a published version an onboarding holds cannot be deleted out from
under it), and a check constraint ties the two acceptance facts together — `(status = 'accepted') =
(accepted_at IS NOT NULL)` — so neither can be written without the other.

Every foreign key in the schema is declared by a `@ManyToOne`/`@JoinColumn` pair on the owning
entity, carrying `onDelete` and `foreignKeyConstraintName` — the entity is the source of truth, and
the migration that creates the table adds the matching `ALTER TABLE … ADD CONSTRAINT` and states
nothing a decorator does not already say. A reference the schema deliberately leaves unconstrained
— `client_webhook_outbox.onboarding_id` — is declared the same way with
`createForeignKeyConstraints: false` rather than left as a bare column.
`test/foreign-keys.e2e-spec.ts` walks `DataSource.entityMetadatas` against `pg_constraint` in both
directions and fails if entity and database ever disagree; see decision record
[0027](decisions/0027-relations-declared-on-entities.md).

One migration, `0001_initial_schema` (class `InitialSchema0001`, `name` ending in a 13-digit
timestamp — TypeORM parses the last 13 characters), creates the whole schema. A file under the
migrations glob may export nothing but its class: TypeORM instantiates every export as a migration.
Later migrations continue the sequence as `0002_description.ts`: `0002_create_otp_challenges`
creates `otp_challenges`, unique on `(onboarding_id, channel)`, then adds its foreign key to
`onboardings` separately ([0048](decisions/0048-engine-owned-otp-with-channel-adapters.md)).

No migration has ever run against a deployed environment, so the incremental history (fifteen
files, `0001_init` to `0033_add_onboardings_created_at_index`) was folded into this one: it states
the schema as it is, not how it got there. It creates the tables in dependency order, each followed
by its own indexes — among them the two partial `onboardings` indexes the encryption sweep reads,
`idx_onboardings_in_progress_version` behind the admin workflows list's in-progress count
([0032](decisions/0032-admin-workflows-list.md)), `idx_onboardings_created_at_id` on
`onboardings (created_at DESC, id DESC)`, the order of the admin list and of the CSV export's keyset
batches ([0044](decisions/0044-streamed-onboardings-csv-export.md)), and
`uq_workflow_versions_one_draft`, which limits a family to one draft
([0034](decisions/0034-admin-authored-workflow-drafts.md)) — then adds every
foreign key as a standalone `ALTER TABLE … ADD CONSTRAINT`, and creates the
`onboarding_agreement_statuses` view last. The fold was checked by applying the old set and the new
migration to two empty databases and diffing `pg_dump --schema-only`: the schemas are identical,
column order included. Local stacks are the one place the incremental set did run: a Compose volume
created before the fold has a `migrations` table listing the old names, so the engine tries to
create tables that already exist and exits at boot. Such a stack is thrown away once with
`pnpm stack:reset`; nothing converges it.

`onboarding_documents.requested_max_size_bytes` / `verified_size_bytes` use a transformer that
throws on values outside the JS safe-integer range, rather than silently returning a lossy number
from `BIGINT`.

Application-level encryption of the data a user submits during onboarding is turned on and off
by an operator from the admin panel's Encryption page (`PATCH /v1/admin/encryption`, §11) — never
from configuration and never per workflow. While it is on, a TypeORM `ValueTransformer`
(`encryption/encrypted-json.transformer.ts`) wraps `onboardings.context` in an envelope — `{
"__tsh_enc": "aes-256-gcm.v1", "k": "<key id>", "d": "<base64 iv||authTag||ciphertext>" }` —
stored as the column's existing `jsonb` value rather than a new column or type, so
`chk_onboardings_context_object`'s `jsonb_typeof(context) = 'object'` still holds. The column label
(`onboardings.context`) is authenticated as additional data, so ciphertext copied into a different
column fails to decrypt. Reading never depends on the current state: an envelope decrypts whether
or not encryption is on, because the key ring retains every key, and plain JSON reads back as is.

`ENCRYPTION_KEY` (§10) never encrypts data directly. It is the key-encryption key (KEK) that wraps
each data key stored in `encryption_keys`, one row per key ever created, unwrapped by
`EncryptionKeyRingService` into an in-process ring keyed by id. Whether encryption is on is derived
from that table — "on" means a row with `deleted_at IS NULL` exists — rather than stored a second
time: turning it on inserts a key, turning it off soft-deletes the active one, rotating
(`POST /v1/admin/encryption/keys`) does both in one transaction. The partial unique index
`uq_encryption_keys_active` (migration `0001_initial_schema`) makes "at most one unretired row" a database
invariant. Nothing self-provisions: a fresh deployment has no key until an operator turns
encryption on, and the engine refuses to boot when the table holds keys but the process has no
KEK, since every row those keys protect would be unreadable.

Every change takes effect one `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` after it is made: an
incoming key's `activated_at` and an outgoing key's `deleted_at` are set to that future instant,
not `now()`, so `engine` and `engine-worker` — separate processes, each refreshing its ring on that
interval — have all learned of the change before any write depends on it. A key is active from its
`activated_at` until its `deleted_at`; on a rotation the two flip together, so there is never an
instant with two active keys, and turning encryption off leaves none. `GET /v1/admin/encryption`
reports each key's `active` and `pendingActivation` flags from those timestamps, and `enabled` from
the table, so the panel can show "turning on" and "turning off" during the window. The ring
resolves "which key is active" from those timestamps on every call, against the current time,
rather than once per reload, so the window closes at exactly the instant the table names on every
process alike. The admin request reloads the local ring after its commit as a best-effort
shortcut — a failure there is logged, never surfaced, since the periodic refresh makes the change
correct without it and the audit row must still be written. A rotation's own two audit rows are
best effort for the same reason taken one step further: turning encryption on or off is
idempotent, so a `500` over a missed audit row costs nothing but the row, whereas `POST /keys`
rotates on every call — reporting a committed rotation as failed would invite a retry that
supersedes the key a second time.

Soft delete never destroys material — the row and its wrapped key are retained, both because rows
written under that key keep naming it until they are next written and as permanent history. A
superseded key is therefore read-only but live, not transitional: it may be the key a row names
indefinitely. The honest consequence: a database dump still yields every key that ever protected
`onboardings.context`, so rotation limits future exposure rather than past exposure.

`EncryptionSweepService` (running only under `MODE=worker-only`/`MODE=all` and only on a process
holding the KEK; `MODE=api-only` starts no sweep) polls every `ENCRYPTION_SWEEP_POLL_INTERVAL_MS`
and moves up to `ENCRYPTION_SWEEP_BATCH_SIZE` rows per tick toward whatever the table says: plain
JSON rows onto the active key while encryption is on, every envelope back to plain JSON while it is
off. It serves the on/off toggle alone. **A rotation sweeps nothing** (record 0026): the sweep
names no source key while encryption is on, so a row already carrying an envelope stays on
whichever key it names and moves onto the current key only when it is next written. `progress`
counts to match — a row on a superseded key is not pending, or the count would never reach zero
after a rotation. Each row is loaded through `OnboardingEntity` and written back with
`Repository.update`, so the transformer performs the actual decrypt and re-encrypt rather than a
raw SQL write that would store plaintext, and `updated_at` is passed through unchanged. Rows are
found by index, never by an inequality a btree cannot serve: an equality against the key ids the
ring can read (`idx_onboardings_encryption_key`) plus the partial index over plaintext rows
(`idx_onboardings_plaintext_context`, migration `0001_initial_schema`); a row the sweep cannot read — tampered
ciphertext, or a key this process cannot unwrap — is skipped, audited once as
`encryption.reencryption_failed`/`decryption_failed` naming the onboarding, and left for a peer or a
restart, so one such row never stalls the rest. The `reencryption_*` audit actions keep their names
as stored vocabulary, though that direction now only ever encrypts rows that were never encrypted. Every change is therefore asynchronous: the admin
request returns immediately, and a row the sweep has not reached yet still carries its previous
form and reads normally. Progress is a count against the target state, derived from the rows
themselves — never a stored counter — and `GET /v1/admin/encryption` reports it as
`progress.pending`/`total`, and `GET /v1/admin/encryption` reuses one count for two seconds so the
panel's poll — every few seconds, from every open tab, for the whole of a sweep — does not scan
`onboardings` once per reader; every committed change drops it. Each change of target is its own
audit episode (`encryption.reencryption_started`/`completed` toward a key,
`encryption.decryption_started`/`completed` toward plain JSON), recorded exactly once across
replicas under an advisory lock. The `completed` row is written by whichever check first observes
nothing pending — the full count, or the cheap steady-state probe on a tick that was idling — so a
target that drains while this process holds no rows still closes its episode.

`POST /v1/admin/encryption/reencryption` is the one way to move stored rows off a key deliberately,
for a data key whose material leaked. It stamps `encryption_keys.reencrypt_requested_at` on the
active row (migration `0001_initial_schema`) and audits `encryption.reencryption_requested`; while that stands the
sweep widens its sources back to every key it can read, `progress.pending` counts rows not yet on
the active key, and the sweep clears the column once none are left — so the request is
self-retiring and a replica restarting mid-run resumes from the table. Each row is decrypted and
re-encrypted inside one transaction, so nothing is ever stored as plain JSON on the way, which is
what separates this from turning encryption off and on again.

A row the sweep cannot read is skipped, audited once and remembered so no later claim selects it
again, up to `MAX_REMEMBERED_UNMOVABLE_IDS` (1000) per process; the whole set is bound into every
probe and claim, so past that cap a row is still skipped but no longer remembered, warned about or
audited, and the process logs `ENCRYPTION_SWEEP_UNMOVABLE_LIMIT_REACHED` once per target. Reaching
it means a misconfiguration only an operator can fix, usually a key-encryption key that changed.

Rotation is both manual and scheduled. `POST /v1/admin/encryption/keys` rotates now; the active
key additionally carries how often the engine should rotate it on its own (`rotation_interval`,
migration `0001_initial_schema`: `48h`, `96h`, `1w`, `2w` or `1mo`, or `NULL` for never), so the one row with
`deleted_at IS NULL` holds both "encryption is on" and "this is when it next rotates" rather than a
settings row beside it. Turning encryption on schedules nothing — a rotation moves no rows, so a
cadence only accumulates keys; `PATCH /v1/admin/encryption/rotation`
changes or clears it (`encryption.rotation_schedule_changed`), and a key with `NULL` there rotates
on no schedule until an operator chooses one. That write returns the id it landed on
(`UPDATE … RETURNING id`) and the audit row names that key rather than the one the request read
first, so a rotation committing mid-request — which moves `deleted_at IS NULL` onto the incoming
key, where the schedule then lands — is recorded against the key actually carrying it. The next rotation is the active key's
`created_at` plus that interval, so every rotation — scheduled or manual — restarts the countdown
by creating a row, and an interval shorter than the active key's current age falls due at once.
`EncryptionKeyRotationService` (the same gating as the sweep: `MODE=worker-only`/`MODE=all`, KEK
held) checks every `ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS` and hands the decision to
`EncryptionAdminService.rotateIfDue`, which re-reads the key and re-checks due-ness inside one
transaction under the `lockKeyRotation` advisory lock, so concurrent replicas cannot each rotate
the same due key. A scheduled rotation writes the same `encryption.key_added`/`key_superseded`
pair a manual one does, with `actor_type` `system` rather than `operator`, and moves no rows — a
scheduled rotation is as lazy as a manual one.

**Not covered**: connector credentials (`connectors.settings`) are operator-supplied
configuration, not onboarding input, and stay plaintext regardless of this setting; the same
holds for the `audit_log` payload columns. Uploaded documents never pass through the engine as
plaintext bytes to begin with (§7). **Losing `ENCRYPTION_KEY` (the
KEK) makes every wrapped data key, and therefore every row any of them ever encrypted,
unrecoverable** — there is no escrow, and destroying a retired key's material once it protects
zero rows is a deliberate follow-up, not something this version does.

---

## 10. Configuration

One `AppConfig` class (`config/app.config.ts`), validated by `validateConfig` at bootstrap via
`ConfigModule.forRoot({ validate })`. Nothing reads `process.env` directly in feature code.
`.env.dist` is the documented sample; `ConfigModule` reads `.env` only (the package's, then the
repository root's) and never falls back to `.env.dist`, so a start without `.env` fails validation.

**Every deployment names its environment.** `ENVIRONMENT_NAME` is a required lowercase slug
(`^[a-z0-9][a-z0-9-]{0,62}$`) — `dev`, `staging`, `pre-prod`, `prod` or whatever a promotion path
calls its stages — and `NODE_ENV` is required and one of `development`, `production` or `test`
(`NodeEnv`, `config/environment.config.ts`); neither has a default, so a deployment that omits one
refuses to start. The name is a label for operators (the admin panel shows it, §12) and never
changes behaviour; `NODE_ENV=production` is what the production-only rules read, and `test` is what
lets `CONNECTOR_MOCKS` apply. One engine serves one environment: connector credentials, selections
and onboardings are not partitioned by it ([0047](decisions/0047-deployment-environment-name.md)).

Beyond `class-validator` decorators, `validateConfig` enforces cross-field rules that a decorator
cannot express:

- `CLIENT_WEBHOOK_BASE_URL` — absolute, no credentials/fragment, HTTPS required in production,
  HTTP allowed only for loopback outside production.
- `ADMIN_PANEL_ORIGIN` — a valid origin, used for the CORS allowlist.
- `CONNECTOR_CALLBACK_UNSIGNED_TYPES` — parsed and rejected if malformed.
- SMTP: when enabled, host/port/from are required; `SMTP_SECURE` and `SMTP_STARTTLS` are mutually
  exclusive; **plaintext is permitted only when the host is `mailhog`**, so a production SMTP
  target cannot be configured unencrypted by omission.
- `WEBHOOK_OUTBOX_WORKER_LEASE_MS >= CLIENT_WEBHOOK_TIMEOUT_MS + 5000`.
- `ENCRYPTION_KEY` — the key-encryption key (§9) — is optional, but when set it must be a
  base64-encoded string that decodes to exactly 32 bytes (`config/encryption.config.ts`'s
  `parseEncryptionKey`); non-base64 or the wrong decoded length throws a named error and the engine
  refuses to start. An empty value counts as unset, which is how `docker-compose.yml` forwards an
  absent `.env` entry. Whether encryption is on is not configuration at all: it is decided from the
  admin panel and derived from `encryption_keys`. A process without the key boots only while that
  table is empty, and can neither turn encryption on nor rotate a key
  (`ENCRYPTION_KEY_NOT_CONFIGURED`).
- `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` (default 15000, minimum 1000) — how often
  `EncryptionKeyRingService` re-reads `encryption_keys` in the background, and therefore how long
  every change to the ring waits before it takes effect, so a change made on one process reaches
  every other process before any write depends on it.
- `ENCRYPTION_SWEEP_POLL_INTERVAL_MS` (default 5000, minimum 500) and
  `ENCRYPTION_SWEEP_BATCH_SIZE` (default 100, minimum 1, maximum 1000) — how often
  `EncryptionSweepService` polls for `onboardings.context` rows not yet in the chosen state and how
  many it moves per tick; both apply only under `MODE=worker-only`/`MODE=all`, since
  `MODE=api-only` starts no sweep.
- `ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS` (default 60000, minimum 1000) — how often
  `EncryptionKeyRotationService` asks whether the active key's stored rotation schedule has come
  due. Not the schedule itself: that is chosen per key from the admin panel (§9) and stored on the
  key, so this only sets how promptly the engine notices. Applies under the same modes as the
  sweep.

`OTP_SMS_TIMEOUT_MS` (default 10000, minimum 100, maximum 30000) is how long `twilio_sms_otp`
waits for Twilio Programmable Messaging before raising `OTP_DELIVERY_FAILED`. The
Twilio credentials themselves are connector settings, not configuration.

`OTP_DATABASE_POOL_SIZE` (default 5, minimum 1, maximum 50) sizes the OTP challenges' own
connection pool (§4, "The OTP connectors"), opened on the first OTP step beside the main pool, so a
process holds up to that many connections more than the main pool's.

Timeouts are bounded rather than free-form (`CLIENT_WEBHOOK_TIMEOUT_MS`, `HTTP_CONNECTOR_TIMEOUT_MS`,
`OTP_SMS_TIMEOUT_MS`, `SMTP_TIMEOUT_MS`, `SUMSUB_TIMEOUT_MS`, `VERIFF_TIMEOUT_MS`: 100–30000).
`SUMSUB_BASE_URL` (default `https://api.sumsub.com`) and `SUMSUB_TIMEOUT_MS` are deployment
settings on `AppConfig`, not credentials — `sumsub_kyc`'s `appToken`/`secretKey` are DB-backed
like every other adapter's `settingsSchema` (§4). So are `VERIFF_BASE_URL` (default
`https://stationapi.veriff.com`, the same host for test and live — the API key decides the mode)
and `VERIFF_TIMEOUT_MS` (default 10000, as Sumsub's); `veriff_kyc`'s `apiKey`/`sharedSecretKey` are
DB-backed.

**No connector credential is declared in `AppConfig` any more.** `SENDGRID_API_KEY`, `SENDGRID_FROM`,
`SMTP_USERNAME` and `SMTP_PASSWORD` are all deleted outright. `HTTP_CONNECTOR_SECRETS` stays,
because `http_request` is not an operator-configurable connector (§4). `ENCRYPTION_KEY` is the
one setting the encryption of `onboardings.context` (§9) needs — the key-encryption key, absent by
default so a fresh deployment behaves exactly as it did before this existed — while turning
encryption on, off, rotating its data key and choosing how often it rotates on its own all happen
in the admin panel, never by editing `.env` again. The engine boots with no connector credential configured anywhere; a
workflow that reaches a connector whose required credential has no `connectors` row gets
`503 CONNECTOR_NOT_CONFIGURED` at execution time. Every real connector must be configured through
`/v1/admin/connectors` before it can run — nothing is read from `.env` on its behalf.

Host-side Compose ports are all overridable (`POSTGRES_PORT`, `REDIS_PORT`, `STORAGE_S3_PORT`,
`ENGINE_PORT`, `MAILHOG_HTTP_PORT`) while in-network addresses stay fixed;
the README documents each override and its blast radius. The admin panel has no port of its own —
`ENGINE_PORT` publishes both halves (§13).

`AppConfig` also carries the admin panel's own settings — `ADMIN_PANEL_DIST_DIR` and the seven
`VITE_*` keys — because the panel is served by the engine. The engine never acts on the `VITE_*`
values; it renders them into the panel's `/config.js` (§12).

---

## 11. HTTP surface and error contract

| Method | Path                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/health/live`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| POST   | `/v1/onboardings` — body `{ workflowId }`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| GET    | `/v1/onboardings` — filters `status`, `workflowId`, `workflowVersion`, `currentStep`, `onboardingId`, `agreementStatus` (`current` \| `outdated` \| `not_accepted`), `parked` (`true` \| `false`), `pendingConnectorId`, `parkedBefore` (ISO-8601, against the park's `parkedAt`)                                                                                                                                                                                                         |
| GET    | `/v1/onboardings/export` — the same filters without `page` and `limit`; every match as `text/csv`, streamed                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/v1/onboardings/:id` — the admin record for one onboarding                                                                                                                                                                                                                                                                                                                                                                                                                               |
| GET    | `/v1/onboardings/:id/transitions` — the states it moved through, oldest first                                                                                                                                                                                                                                                                                                                                                                                                             |
| GET    | `/v1/onboardings/:id/state`                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/v1/onboardings/:id/submit`                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| POST   | `/v1/onboardings/:id/review/:action`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| POST   | `/v1/onboardings/:id/pending-connector/reconcile` — admin; reads a parked connector's verdict back from its provider and applies it through the submit path (§5); `200 { outcome: applied \| still_pending \| superseded, onboarding }`, nothing is created                                                                                                                                                                                                                               |
| POST   | `/v1/onboardings/:id/documents`                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| POST   | `/v1/onboardings/:id/documents/:documentId/complete`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/v1/onboardings/:id/agreements` — accepted-versus-latest per family, ordered by `key`                                                                                                                                                                                                                                                                                                                                                                                                    |
| POST   | `/v1/onboardings/:id/agreements` — body `{ agreementId }`, links one published version; `200`, not `201`, because it is idempotent                                                                                                                                                                                                                                                                                                                                                        |
| POST   | `/v1/onboardings/:id/agreements/:agreementId/accept` — `200`; the end user accepts a link the onboarding already holds, and the only unguarded agreement route                                                                                                                                                                                                                                                                                                                            |
| POST   | `/v1/admin/agreements` — body `{ key, type }`, publishes the next version of a family; `201`                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/v1/admin/agreements` — every published version, filters `key`, `type`, paginated                                                                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/v1/admin/audit`                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/v1/admin/workflows` — every family the active scopes contain; filters `search`, `scope`, `hasDraft`, paginated, ordered by `key`                                                                                                                                                                                                                                                                                                                                                        |
| GET    | `/v1/admin/workflows/:workflowId` — the highest `published` version's definition with each step's `source`, `fields` and `connectors` (identity and field mapping, never `config`) and the root `webhook`; takes no `version` parameter                                                                                                                                                                                                                                                   |
| GET    | `/v1/admin/workflows/:workflowId/versions/:version` — the same definition for one stored revision, any status including `retired` and `draft`; `400 WORKFLOW_INVALID` for a draft that does not compile; `404 WORKFLOW_NOT_FOUND`                                                                                                                                                                                                                                                         |
| GET    | `/v1/admin/workflows/:workflowId/versions` — every stored version, `{ items: [{ version, status, createdAt, updatedAt }] }`, highest first, unpaginated; `404 WORKFLOW_NOT_FOUND` for an unknown or out-of-scope family                                                                                                                                                                                                                                                                   |
| POST   | `/v1/admin/workflows/compile` — an authored workflow; a dry run of every startup check, storing nothing; `200 { definition, steps, workflow }`                                                                                                                                                                                                                                                                                                                                            |
| POST   | `/v1/admin/workflows` — a raw workflow document as the body; stores a draft in `users` scope without compiling it; `201` with the draft summary (`workflowId`, `version`, `status`, `name`, `createdAt`, `updatedAt`); `400 WORKFLOW_INVALID` for a body without a string `id` or a positive integer `version` of at most 2147483647; `409` `WORKFLOW_VERSION_EXISTS`, `WORKFLOW_DRAFT_EXISTS` or `WORKFLOW_SCOPE_CONFLICT`                                                               |
| GET    | `/v1/admin/workflows/:workflowId/versions/:version/document` — the version summary (`status` of any value) plus the stored `document` verbatim, connector `config` included; `404 WORKFLOW_NOT_FOUND`                                                                                                                                                                                                                                                                                     |
| PUT    | `/v1/admin/workflows/:workflowId/versions/:version` — replaces a draft with the raw document in the body, which may change its `id` and `version`; `200` with the draft summary; `409` `WORKFLOW_VERSION_NOT_DRAFT`, `WORKFLOW_DRAFT_IN_USE` and the three create codes                                                                                                                                                                                                                   |
| POST   | `/v1/admin/workflows/:workflowId/versions/:version/publish` — no body; compiles the stored draft and makes it `published`; `200` with the draft summary, `status: 'published'`, and no document; `409` `WORKFLOW_VERSION_NOT_DRAFT`, `WORKFLOW_VERSION_NOT_LATEST` and `WORKFLOW_VERSION_EXISTS` (a workflow file declares the same id and version), plus the compile route's `400 WORKFLOW_INVALID`, `400 WORKFLOW_CONNECTOR_DECLARATION_INVALID` and `409 WORKFLOW_SOURCE_KEY_CONFLICT` |
| DELETE | `/v1/admin/workflows/:workflowId/versions/:version` — deletes a draft; `204`; `409 WORKFLOW_VERSION_NOT_DRAFT` or `WORKFLOW_DRAFT_IN_USE`                                                                                                                                                                                                                                                                                                                                                 |
| PUT    | `/v1/admin/workflows/:workflowId/steps/:stepName/connector` — body `{ connectorId, scope: 'version' \| 'all', version? }` (`version` required exactly when `scope` is `version`), binds the step's single connector slot to that adapter on that published version or on the covered set (§2); `200` with the slot's connector projection, including `versions`, from the target version (the highest covered one for `all`); the refusals are listed in §2                               |
| DELETE | `/v1/admin/workflows/:workflowId/steps/:stepName/connector?scope=version&version=N` or `?scope=all` — removes the selection on that version or on the covered set, back to the authored connector; `204`, also when none existed; rows on retired versions are kept                                                                                                                                                                                                                       |
| GET    | `/v1/admin/step-types` — the step-type palette: type, category, `composable`, `configSchema`                                                                                                                                                                                                                                                                                                                                                                                              |
| GET    | `/v1/admin/step-types/schema` — the workflow JSON Schema as the engine applies it                                                                                                                                                                                                                                                                                                                                                                                                         |
| GET    | `/v1/admin/connectors` — every configurable connector's settings state                                                                                                                                                                                                                                                                                                                                                                                                                    |
| GET    | `/v1/admin/connectors/:connectorId`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| PUT    | `/v1/admin/connectors/:connectorId` — body `{ settings: Record<string, string> }`, replaces wholesale; `?replace=true` opts into dropping a currently stored key that the body omits                                                                                                                                                                                                                                                                                                      |
| PATCH  | `/v1/admin/connectors/:connectorId` — body `{ settings: Record<string, string \| null> }`, merges the submitted keys; `null` deletes one                                                                                                                                                                                                                                                                                                                                                  |
| DELETE | `/v1/admin/connectors/:connectorId`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| GET    | `/v1/admin/encryption` — `{ enabled, keyConfigured, keys, rotation: { interval, nextRotationAt }, progress: { pending, total } }`: the chosen state, whether this process holds the KEK, the full key history, the automatic-rotation schedule, derived sweep progress                                                                                                                                                                                                                    |
| PATCH  | `/v1/admin/encryption` — body `{ enabled }`, turns encryption on (creating a key) or off (retiring the active key); idempotent; `200` with the same shape as `GET`                                                                                                                                                                                                                                                                                                                        |
| POST   | `/v1/admin/encryption/reencryption` — moves every stored onboarding onto the active key, for a leaked data key; idempotent; `200` with the same shape as `GET`                                                                                                                                                                                                                                                                                                                            |
| PATCH  | `/v1/admin/encryption/rotation` — body `{ interval }` (`48h`/`96h`/`1w`/`2w`/`1mo`, or `null` to stop rotating automatically), measured from the active key's creation; idempotent; `200` with the same shape as `GET`                                                                                                                                                                                                                                                                    |
| POST   | `/v1/admin/encryption/keys` — rotates the key now; `201` with only the new key's id, never material                                                                                                                                                                                                                                                                                                                                                                                       |
| POST   | `/v1/webhooks/:providerKey/callback`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| GET    | `/v1/openapi.json` — the OpenAPI document (below); served by the HTTP adapter rather than a controller, so it is not itself an operation in the document                                                                                                                                                                                                                                                                                                                                  |

A global `ValidationPipe({ whitelist: true, transform: true })` is registered. Two routes are the
deliberate exceptions: `DynamicSubmitBodyPipe` on submit and `RawWorkflowDocumentPipe` on compile
and on the draft create and replace routes pass the body through untouched, because whitelist stripping would delete workflow-configured field
names — or a document's own properties — before the runtime ever sees them, and silently dropping
an unknown field is exactly the error the step validator, or the DDL, must report.

The agreement responses, as the DTOs write them:
`POST /v1/admin/agreements` returns `{ id, key, type, version, publishedAt, linkedOnboardings }`,
and `GET /v1/admin/agreements` returns the same object without `linkedOnboardings`, in the standard
`{ items, meta }` envelope. `GET /v1/onboardings/:id/agreements` returns
`{ onboardingId, items: [{ key, type, latestAgreementId, latestVersion, acceptedVersion, acceptedAt, status }] }`
ordered by `key` — an onboarding holding no links reads as `items: []`, not a 404.
`POST /v1/onboardings/:id/agreements` returns `{ onboardingId, agreementId, key, version, created }`,
where `created` is `false` when the pair was already linked; the accept route returns the same
identity fields with `acceptedAt` in place of `created`. Every admin summary
(`AdminOnboardingSummaryResponseDto`) — both the
`GET /v1/onboardings` list items and `GET /v1/onboardings/:id` — carries `agreementStatus`.

`GET /v1/onboardings/export` ([0044](decisions/0044-streamed-onboardings-csv-export.md)) returns
every onboarding matching the list's filters, not one page — `ExportAdminOnboardingsQueryDto` is
`ListAdminOnboardingsQueryDto` without `page` and `limit`, which the whitelist strips — and the
list keeps its 100-row ceiling. It is declared above `GET /v1/onboardings/:id` because Nest matches
in declaration order. The response is `200` with `Content-Type: text/csv; charset=utf-8`,
`Cache-Control: no-store` and
`Content-Disposition: attachment; filename="onboardings-<yyyyMMddTHHmmssZ>.csv"` (UTC), and
a malformed filter is a `400` `VALIDATION_ERROR` as on the list, before any audit row. The body is a
UTF-8 BOM, a header row, then one row per match in the list's order, `created_at DESC, id DESC`; no
match yields the header alone. Against a running engine,
`GET /v1/onboardings/export?workflowId=does-not-exist` returned those three headers and exactly
`Onboarding id,Workflow id,Workflow version,Status,Current step,Agreement status,Rejection reason,Created at,Updated at,Completed at,Other data`
after the BOM.

The header row holds labels, not keys, and every label is derived from its key by one rule, with no
hand-written labels or overrides. The fixed columns are `Onboarding id, Workflow id,
Workflow version, Status, Current step, Agreement status, Rejection reason, Created at, Updated at,
Completed at` (`expiresAt` is omitted: it is reserved and always `null`), then one `<name> score`
column per score name, sorted, then one column per persisted field (`persist !== false`) labelled by
its name, then a final `Other data`. A key (`onboardingId`, a score name, a field name, `otherData`)
is humanized: it is split on `_`, `-`,
whitespace, a lowercase-or-digit to uppercase boundary and the last capital of an uppercase run
before a lowercase letter, and each word is lowercased unless it is two or more capitals with no digits
(`onboardingId` becomes `Onboarding id`, `userID` becomes `User ID`, `amlRisk` becomes `Aml risk score`, `address2` becomes `Address2`); the
first letter is capitalised, and a name with no words keeps its raw key. Labels are not made unique:
a score and a field sharing a name give `Risk score` and `Risk`, and two names can collapse to one
label (`first_name`, `firstName`), so a reader must go by column position. The score and data
columns come from the workflow definitions, not from the stored data, because `context` may be
encrypted (ADR 0024) and SQL cannot list its keys: one query lists the distinct
`(workflow key, version)` pairs in the filtered set, `WorkflowRegistryService.getDefinitionForAdmin`
resolves each — **`retired` revisions included**, since an export is a historical read — and the
fields are the union over definitions ordered by workflow key then version, in step order, the
first appearance winning. `Other data` holds, as JSON, every context key no declared column covers
(a connector's `kycOutcome`, say) and is empty when there are none, so nothing collected is dropped.
A version that no longer resolves (`WorkflowNotFoundException` or `WorkflowRevisionNotFoundError`)
contributes no columns and its whole context lands in `Other data`; the export does not fail on it.

Encoding follows RFC 4180: comma separator, CRLF line ends, a field quoted when it contains `"`,
`,`, CR or LF with inner quotes doubled. Dates are ISO 8601 UTC, `null` and absent values are empty
cells, numbers and booleans go through `String()`, and objects and arrays (uploaded documents,
multi-selects) are `JSON.stringify`'d. **Formula guard:** a string cell starting with `=`, `+`, `-`,
`@`, TAB or CR gets a leading `'`; numbers are never touched. The pure encoding lives in
`onboardings/domain/onboardings-csv.ts`, with no Nest imports.

`OnboardingsExportService.exportCsv` resolves the columns, writes the audit row, then returns an
async generator that the controller wraps in a `StreamableFile` over `Readable.from`, so memory holds one batch rather
than the table. It reads in
keyset batches of 5000 over the list's own order, the cursor being the last row's `id`, bound as
`:lastId` in
`(created_at, id) < (SELECT created_at, id FROM onboardings WHERE id = :lastId)`; comparing in SQL
avoids the millisecond truncation a JS `Date` would apply to Postgres' microsecond `timestamptz`,
and unlike an offset it does not re-read rows shifted by concurrent inserts. A batch shorter than
5000 ends the stream; each batch is one query, a range read on `idx_onboardings_created_at_id`.
It uses `.limit()`, not `.take()`: every join is to-one, and with joins `.take()` makes TypeORM
select the page's ids through a `DISTINCT` subquery and reload them by `IN (…)`, a reload Postgres
answered with a scan of the whole table on every batch. Over 200k rows the batch reads alone took
16–23 s that way and 6–8 s with `.limit()`. Reads use `dataSource.manager`, outside a transaction,
as the list does.
A batch does not join `onboarding_agreement_statuses`: joined, the view aggregates every
`onboarding_agreements` row on every batch, which measured about 110 ms a batch at 100k rows. 5000 was chosen by measurement: on 200k rows it
exported in 8.4 s against 10.1 s at 500, while 50,000 saved under a second for a 1.5 s first batch
and more memory. The status lookup binds one parameter per id, so a batch must stay below the
65,535 parameters Postgres accepts in one query. Instead
a second query reads the view `WHERE onboarding_id IN (<the batch's ids>)`, which Postgres applies
inside the view's grouping, and a missing row still means `not_accepted`. An export filtered by
`agreementStatus` keeps the join, because the filter is a condition on it, and pays that cost.
`context` is decrypted on hydration by the column transformer, so the file carries plaintext
collected data.

`OnboardingsExportService.exportCsv` resolves the columns first (the distinct workflow versions,
which join the agreement-status view only when filtering on it, as a batch does, then the registry
lookups), and only then writes an `onboardings.exported` audit row (§8) with
`AuditService.logOnboardingsExport`, in its own transaction. A failure while resolving the columns
throws out of the controller as an ordinary 500: the global filter audits it as
`api.request_failed` and no export row exists. Once the stream has started the status is already
`200`, so a failure after that point aborts the connection rather than ending the file early; the
panel's axios download then rejects and saves nothing. The `StreamableFile` error handler records
that failure as `api.request_failed` through `ApiFailureAuditFilter.recordFailure`, which `AuditModule`
exports (the `APP_FILTER` binding uses `useExisting`, so it is the one global instance), while the
export row written before it stays. A client that disconnects mid-export destroys the stream, which
ends the generator; the controller does this on the response's `close` when it did not finish, since
Nest only unpipes. A disconnect writes no failure row.

There is exactly one exception filter, `ApiFailureAuditFilter`, registered as an `APP_FILTER` in
`AuditModule`. It exists **only to observe**: it extends Nest's `BaseExceptionFilter` and its
`catch()` calls `super.catch(exception, host)` first and unchanged, so serialization, status and
headers are delegated entirely to Nest's default handling — proven by
`api-failure-audit.filter.spec.ts`, which compares this filter's response against a bare
`BaseExceptionFilter` on the same exception. Everything after that call only reads the exception
and the request to schedule a best-effort `api.*` audit write (§8); it never touches the response.
Errors themselves are unaffected: they are still small feature-local classes extending the right
Nest HTTP exception, each owning a fixed `{code, message}`, and there is still no global error
enum:

| Code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `ONBOARDING_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `WORKFLOW_STEP_NOT_FOUND` (carries `stepName`), `DOCUMENT_UPLOAD_NOT_FOUND`, `CLIENT_WEBHOOK_OUTBOX_NOT_FOUND`, `CONNECTOR_NOT_FOUND`, `AGREEMENT_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                                                                                                 | 404       |
| `INVALID_STEP_DATA` (carries the field-error map), `INVALID_DOCUMENT_UPLOAD`, `CONNECTOR_SETTINGS_INVALID` (carries every offending key), `AGREEMENT_TYPE_MISMATCH` (publishing under an existing `key` with a different `type`)                                                                                                                                                                                                                                                                                                                                                                                           | 400       |
| `WORKFLOW_INVALID` (carries `reason` and, when known, `path`), `WORKFLOW_CONNECTOR_DECLARATION_INVALID` (carries `stepName` and the adapter's `detail`), `WORKFLOW_CONNECTOR_SELECTION_INVALID` (carries `reason` — the table in §2 — `stepName`, `connectorId`, the refusing `workflowVersion` and, when there is one, `detail`)                                                                                                                                                                                                                                                                                          | 400       |
| `WORKFLOW_SOURCE_KEY_CONFLICT` (carries `sourceKey` and `conflictingWorkflowId`), `WORKFLOW_VERSION_EXISTS` (carries `workflowId` and `version`), `WORKFLOW_DRAFT_EXISTS` (carries `workflowId` and `draftVersion`), `WORKFLOW_SCOPE_CONFLICT` (carries `workflowId` and `scope`), `WORKFLOW_DRAFT_IN_USE` (carries `workflowId` and `version`), `WORKFLOW_VERSION_NOT_DRAFT` (carries `workflowId`, `version` and `status`), `WORKFLOW_VERSION_NOT_LATEST` (carries `workflowId`, `version` and `latestPublishedVersion`), `WORKFLOW_VERSION_NOT_PUBLISHED` (carries `workflowId` and `version`; reached by no route yet) | 409       |
| `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION`, `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED`, `AGREEMENT_VERSION_CONFLICT` (two concurrent publishes on one family; the `UNIQUE (key, version)` loser)                                                                                                                                                                                                                                                                                                                                                                  | 409       |
| `ONBOARDING_AWAITING_CONNECTOR` — a client submit while the row is parked; carries `pendingConnector` (`connectorId`, `connectorName`, `connectorOrder`, never the provider reference) (§3); `ONBOARDING_NOT_AWAITING_CONNECTOR` — a reconcile of a row with no park; `PENDING_CONNECTOR_RECONCILE_UNSUPPORTED` — carries `connectorId` and `reason` (`adapter` \| `reference_missing`) (§5)                                                                                                                                                                                                                               | 409       |
| `ENCRYPTION_DISABLED` — `POST /v1/admin/encryption/keys` or `PATCH /v1/admin/encryption/rotation` while encryption is turned off; `ENCRYPTION_KEY_RING_CONFLICT` — two rotations at the same instant (the `uq_encryption_keys_active` loser); two operators turning encryption on at once is not a conflict, the loser is answered with the resulting state                                                                                                                                                                                                                                                                | 409       |
| `ENCRYPTION_KEY_NOT_CONFIGURED` — turning encryption on or rotating from a process with no `ENCRYPTION_KEY`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 503       |
| `ASYNC_CALLBACK_RAW_BODY_REQUIRED`, `ASYNC_CALLBACK_PROVIDER_KEY_INVALID`, `ASYNC_CALLBACK_AUTHENTICATION_FAILED` (§5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 400       |
| `ASYNC_CALLBACK_SIGNATURE_INVALID` — `503` for a configuration-gap reason (missing `callbackAuth`, missing signing secret), `401` otherwise (§5)                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 401 / 503 |
| `WORKFLOW_RETIRED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 410       |
| `CONNECTOR_NOT_CONFIGURED` — a required credential resolves nowhere at execution time; `AGREEMENT_NOT_PUBLISHED` — a workflow step declares a family with no published version, hit at onboarding start                                                                                                                                                                                                                                                                                                                                                                                                                    | 503       |
| `OTP_DELIVERY_FAILED`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`, `VERIFF_UNAVAILABLE`, `CLIENT_WEBHOOK_DELIVERY_FAILED`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 500       |

_Reasoning_ (`packages/engine/CLAUDE.md`, "Error contracts"): a global error enum becomes a
dumping ground and couples unrelated features. Feature-local classes keep the contract next to the
code that can violate it, and make the semantic status a compile-time choice. Every class also
carries a `static apiDescription`, the one line the OpenAPI document prints beside its code (below).

The global `ValidationPipe` (and `AuditController`'s route-local one) now runs a custom
`exceptionFactory` (`packages/engine/src/validation/validation-exception.factory.ts`) that throws
`ValidationFailedException` instead of Nest's default `BadRequestException`. It reproduces Nest's
default `ValidationPipe` 400 body — `{ message: string[], error: 'Bad Request', statusCode: 400 }`
— **byte-for-byte**, built the same way Nest's own `flattenValidationErrors` builds it, so the
public 400 contract did not change. It additionally exposes `fieldErrors`, a value-free map of
class-validator constraint _keys_ (`isNotEmpty`, `isInt`, never the rendered message, which can
echo a submitted or allowed value, e.g. `@IsIn`) as an instance property outside the response
body, for `ApiFailureAuditFilter` to read into the `api.*` audit row (§8). No new code is exposed
to callers, so the error-code table above gains no `VALIDATION_FAILED` entry.

### Authentication — Microsoft Entra ID on the admin surface

Every route under `/v1/admin/` and the four admin onboarding reads (`GET /v1/onboardings`,
`GET /v1/onboardings/export`, `GET /v1/onboardings/:id`, `GET /v1/onboardings/:id/transitions`) require a verified Microsoft Entra
ID access token, enforced by `AzureJwtGuard` (`packages/engine/src/auth/azure-jwt.guard.ts`) through
the `AdminRoute()` decorator (`packages/engine/src/auth/admin-route.decorator.ts`), which applies the
guard and writes its contract into the OpenAPI document in one step. Every other route — the
customer-facing onboarding flow, `POST /v1/onboardings/:id/review/:action` and provider webhooks —
stays open: there is no Entra identity for an end customer or a provider to hold, so CORS (`main.ts` allows exactly
`ADMIN_PANEL_ORIGIN`, plus origin-less requests, and only
`GET`/`PUT`/`PATCH`/`DELETE`/`OPTIONS`) is that
surface's only constraint, and it constrains browsers, not clients.

The agreement routes follow the same split. Publishing, listing published versions, reading one
onboarding's agreements and linking one to it are operator actions marked `@AdminRoute()`;
`POST /v1/onboardings/:id/agreements/:agreementId/accept` does not, because it serves the end user's
own onboarding flow, which holds no Entra identity. It is also not gated on the onboarding's
lifecycle status — an approved customer still has to be able to accept a new version of the terms.
It is gated on the link already existing: a pair no start, submit, publish or operator link ever
created is `404 AGREEMENT_NOT_FOUND`. Without that, the unguarded route would be a second way to
create a link, and anyone holding an onboarding id could attach any published version to it and
make the next publish of that family notify the client's endpoint.

The spec's API-key scheme (`osk_live_…`, argon2id-hashed, scoped) is unbuilt; Entra SSO is what
shipped instead (`feat: add azure sso for admin panel`).

Configuration (`.env.dist` documents each inline): `ADMIN_AUTH_ENABLED` (default `true`; `false` is
a local-only escape hatch the engine refuses at startup once `NODE_ENV=production`),
`ADMIN_SSO_PROVIDER` (`azure` is the only implemented value — see `docs/EXTENDING.md` to add
another), `AZURE_TENANT_ID` / `AZURE_API_AUDIENCE` (required and validated at startup once auth is
enabled), and `ADMIN_REQUIRED_ROLES` (comma-separated Entra app-role allowlist, default `admin`,
matched case-insensitively against the token's `roles` claim).

The manual review route is the one operator action outside the guard: it predates admin sign-in and
has not been moved behind it. The OpenAPI document tags it on its own and states that this is a
known gap, not a design intent.

A request to a guarded route is refused as:

| Status                  | When                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 401 Unauthorized        | No bearer token, or the token fails signature/issuer/audience/expiry verification                                                 |
| 403 Forbidden           | The token verifies but carries none of `ADMIN_REQUIRED_ROLES` — re-authenticating cannot fix this                                 |
| 503 Service Unavailable | Entra's signing key set could not be reached, so the token was never judged — distinguishes an engine-side fault from a bad token |

Every decision on these routes, granted or refused, is written to the admin access audit trail
(`packages/engine/src/auth/admin-access-audit.port.ts`), so it answers who read admin data, not only
who was turned away. The write is best effort and is not awaited before the response, so a database
outage is reported as `AUTH_AUDIT_WRITE_FAILED` on the engine's own logger instead of taking the
admin endpoints down with it. That leaves writes still running once the response has gone out, so
`AzureJwtGuard.onModuleDestroy` waits for the outstanding ones; Nest runs it before the hook that
destroys the data source, so a restart records the requests it was serving rather than dropping
them.

### The OpenAPI document

`packages/shared/openapi/engine.openapi.json` is the engine's OpenAPI 3.1 document. It is generated
from the controllers' and DTOs' `@nestjs/swagger` decorators by `pnpm openapi:generate`
(`packages/engine/src/openapi/generate-openapi.ts`), committed, and served by a running engine at
`GET /v1/openapi.json` — JSON only, no Swagger UI (`serveOpenApiDocument` in `main.ts`).
`docs/decisions/0015-openapi-document-generated-from-decorators.md` records the choice; this section
describes the mechanism.

**Earlier minor versions are archived.** `info.version` is the engine's `package.json` version.
While that version's `major.minor` equals the committed document's, the generator rewrites the file
in place — a patch bump included. The first run after the version has moved to a new minor or major
first copies the committed document unchanged to
`packages/shared/openapi/versions/<major.minor>/engine.openapi.json` — the last document of the
superseded minor — and only then regenerates it. An archive is written once: the generator refuses
when the folder already exists, and refuses when the engine's version is below the committed
document's. `openapi-document.spec.ts` holds every archived document to its folder (`info.version`
under that `major.minor`, OpenAPI 3.1, no `nullable`) and below the current minor; the folder does
not exist until the first minor has been cut. The documentation site renders each archived document
as a version of the API reference (§13).
`docs/decisions/0045-versioned-openapi-documents.md` records the choice.

**Decorators are explicit.** Every response shape is a class under the feature's `dto/` carrying
`@ApiProperty`; request DTOs carry the same beside their class-validator rules; every route carries
`@ApiOperation` with an `operationId` and a summary, one success response, and its error responses.
The `@nestjs/swagger` compiler plugin is not used: `start:dev` runs under ts-node and the unit suite
under ts-jest, and neither would run it, so the document would be complete only in `nest build`
output. Domain types such as `StepDescription` stay plain (domain code carries no framework
decorators); the DTO classes mirror them and TypeScript checks the service's return structurally.

**`buildOpenApiDocument`** (`packages/engine/src/openapi/openapi-document.ts`) builds the document
from the compiled module graph, then adds what decorators cannot say: the two error envelopes
(`ApiError` for the engine's own `{ code, message }`, `NestHttpError` for the framework's
`{ statusCode, message, error }`), the `JsonValue` and `WorkflowCondition` components, the five
domain enum components declared once in `api-enums.ts` (`WorkflowStatus`,
`ConnectorRejectionReason`, `ConnectorType`, `AgreementType`, `OnboardingAgreementStatus`), and
the authored and compiled workflow JSON Schemas
(`WorkflowDocument`, `CompiledWorkflowDocument`) the DDL derives in memory — mounted verbatim by
`embedJsonSchemaDocument` with their `definitions` relocated to components, which is why the
document is 3.1 rather than 3.0 (3.0's schema subset has no
`if`/`then` or `const`). `toOpenApi31Dialect` then rewrites the one 3.0-ism the decorators still
emit, `nullable: true`, into a `null` type alternative. Tags are per audience (`Onboarding flow`,
`Manual review`, `Provider callbacks`, `Admin: …`, `Health`), declared in `openapi.constants.ts`.

**Errors are documented from the classes that raise them.** `ApiErrorResponses(...)`
(`api-error-responses.decorator.ts`) takes the exception classes a route can throw, constructs each
once and reads its status and `code` off the instance, so the document cannot claim a status or code
the class does not produce; codes are grouped into one response per status with the `code` enum
narrowed to that route. A class whose status depends on its arguments is listed through the
`{ exception, args }` form (`CallbackSignatureInvalidException`, once for `401` and once for `503`).
Refusals the framework answers with its own envelope — DTO validation, a route pipe, the admin
guard before the handler, and an error that is not an `HttpException` escaping it — are listed as
`VALIDATION_ERROR` or `frameworkError(status, text)` and documented with the `NestHttpError`
envelope; a status both can produce is documented as either. The submit and provider-callback
routes list `frameworkError(500, …)` beside their coded `500`s for the second reason:
`WorkflowConnectorExecutorService` re-throws the adapter's own error on `propagate` (§11), and the
built-in `http_request` and KYC adapters raise plain `Error` subclasses, which Nest answers
without a `code`.

**Generation needs no infrastructure.** `testing/create-openapi-app.ts` compiles `AppModule` through
`@nestjs/testing` with TypeORM's `DataSource` provider replaced by a stub and never calls `init()`:
every repository resolves its manager per call and the Redis connection is opened in a lifecycle
hook, so nothing reaches for the network. That is what lets `openapi-document.spec.ts` run in
`pnpm test`: it rebuilds the document and asserts it equals the committed file, then checks
completeness — every one of the 33 routes present, unique `operationId`s, a summary and exactly
one declared tag per operation, one success response with a schema (or a `204`), every path
parameter declared, the bearer requirement on every `Admin:` operation and on nothing else, no
dangling `$ref`, every property typed or deliberately described, and no `nullable` left. What it
cannot see is a response property that was never decorated; that rests on review.
`test/openapi.e2e-spec.ts` checks that the served JSON equals the committed file and that no UI is
served. `.prettierignore` excludes the generated file and the archived copies: the generator's
rendering is the only one, and the drift test compares the parsed documents.

---

## 12. Admin panel

`packages/admin-panel` — React 19, Vite, TanStack Query, Axios, Zod, nuqs. Three sections, built from
`ADMIN_SECTIONS` in `src/app/navigation.tsx`: **Onboardings**, a filterable, read-only list
served from `GET /v1/onboardings` with a details page per onboarding and an Export CSV download; **Logs**, a
filterable, read-only view of the audit trail (§8); and **Connectors**, which writes connector
settings. **Workflows** also writes, but only drafts (Workflows, below).

Every engine read and write fails with one class, `ApiError` (`src/services/api/api-error.ts`),
registered as TanStack Query's `defaultError`
([0036](decisions/0036-mutation-factories-with-invalidation-meta.md)), so `queryOptions` and
`mutationOptions` take no generics. It carries `kind` (`request-failed` or `invalid-payload`),
`status`, `code` (the response body's string `code` for any status, else `null`) and the raw `body`.
Each fetch and write function converts failures with `toApiError(cause, resourceLabel,
describeCode?)`, and a 2xx body that fails its Zod schema with `invalidPayloadError`. A domain with
detail properties reads them through its own reader, `readDraftError` or
`readConnectorSettingsIssues`, which re-validates `body`; encryption maps its 409 and 503 codes to
messages at construction through `describeCode`.

Every signed-in page renders inside `AdminLayout` (`src/app/layout/`): a fixed sidebar —
brand with the engine's environment under it (`EnvironmentBadge`: the `ENVIRONMENT_NAME`, outlined
red when `NODE_ENV=production` whatever it is called, absent under `pnpm dev` where no engine rendered
`/config.js`), the sections under their `group` heading, and the signed-in operator with sign-out — beside
a scrolling content column. The layout mounts no header of its own: **every page renders its own
`PageHeader`**, because the page is what owns the actions and the status that band carries, and a
header mounted a level above its own controls could only be reached by portalling into it. A
section page is handed the `eyebrow` and `title` to render — `ADMIN_SECTIONS` carries a `Component`
rather than an element, and the router renders
`<section.Component eyebrow={section.group} title={section.label} />` — so the sidebar's label and
the page's title stay one declaration. The onboarding details page takes no such props and builds a
richer band of its own (below). The chrome is built from `ADMIN_SECTIONS` alone, so a new section
still costs one entry and no layout change: `ADMIN_NAV_GROUPS` folds the list into the sidebar's
groups, and `findAdminSection` maps any path — a detail page's included — back to the section it
belongs to, which is what keeps that sidebar item marked while a detail page is open; only a
section's root page records its remembered search, and a nested page shows what the root recorded.
The chrome is styled with Tailwind and the shared `SideNav`, `PageHeader` and `Typography`
components. Every section, the onboarding details page and the sign-in screen are Tailwind
throughout; `src/app/styles.css` is gone, its base element rules folded into `tailwind.css`'s
`@layer base`.

`AdminLayout` no longer pads the routed content, because the Onboardings design runs its bands edge
to edge under the header. Every page now draws its own edge-to-edge bands, so the shared `PageBody`
that used to re-apply the old padded, scrolling body is gone — a page wanting that shape declares it
itself. Controls in the header band are simply that `PageHeader`'s children, rendered by the page
that owns them: Connectors puts its live status line there, and the details page builds its own band
with its review actions and Reload in it. The `PageHeaderActions` portal and the module-singleton
slot it needed are gone with the layout-mounted header that made them necessary.

Two supporting choices in `src/app/tailwind.css` and `src/components/ui/icons.ts`. Tailwind's
Preflight sits in the `base` layer, so the browser's own stylesheet no longer decides link colour,
heading size or control fonts; the handful of global rules Preflight leaves unset — focus ring,
disabled controls, body font/colour/background, `#app` flex, `color-scheme` — sit
in that same layer, referencing `@theme` tokens. Icons are the design's own Material Symbols,
outlined at weight 300, imported one SVG per glyph through `vite-plugin-svgr`: the icon font would
cost a 4 MB variable woff2 for a handful of glyphs, and the design's Google Fonts link is ruled out
by the same no-CDN rule as the webfonts in
`src/app/fonts.css`.

The Onboardings section is five bands: the header, a status tab strip, the filter panel, the
scrolling table, and a footer carrying the live status line and the pager. Status is a strip of
links rather than a dropdown, one per entry in `ADMIN_ONBOARDING_STATUSES` plus **All**, each
carrying the committed criteria with `status` set and the page reset — so narrowing by status is a
navigation an operator can middle-click or bookmark, like every other criterion. A count is shown
on the active tab only, taken from the reported `pagination.total`: there is no per-status count
endpoint, and a number that silently meant "on this page" would be worse than none. The onboarding
identifier is the filter grid's first cell, `TextFilterField` labelled **Onboarding ID**, drafted
and committed the same way as every other criterion — it does not have a header search box of its
own, and neither does the Logs section's resource id below. That is a deliberate divergence from
the Figma mocks, which draw both as a search box in the header band: the header search was its own
commit path, bypassing the panel's draft and committing straight to the URL on Enter, so it was
moved into the grid to leave every criterion sharing one commit path — Apply. `SearchInput` remains
in the codebase with no caller, kept deliberately as a parked capability for a future header
search. Three further cells narrow the list to onboardings parked on a connector: a **Parked**
checkbox ("Parked on a connector", `parked=true` — unticked means no criterion, never
`parked=false`, like the Workflows page's draft filter), a **Pending connector** text field
(`pendingConnectorId`, held to the engine's connector-id shape and 100 characters) and a **Parked
before** bound (`parkedBefore`) picked from the same `DateTimePickerField` calendar the Logs window
uses, with the operator's IANA zone noted beneath it. The bound is carried in the URL as the
calendar's local wall-clock value, as `occurredFrom`/`occurredTo` are, and resolved to the ISO
instant the engine compares against only in `useAdminOnboardings`' `toQueryFilters`; an onboarding
parked before the engine began stamping `parkedAt` never matches it.

Because a tab click commits by navigating, which
changes the URL without remounting the page, `status` is deliberately **not** part of the filter
panel's draft state: `AdminOnboardingDraftFilters` is the committed set minus that key, and Apply
reads the status back from `appliedFilters`. A drafted copy would be seeded once at mount and would
silently drop the operator's tab on the next Apply; the panel's "N active" chip counts that
committed status for the same reason. A row's status renders as a `Chip` whose tone comes
from `describeAdminOnboardingStatusTone`, so the state graph and the list colour a status the same
way.

That chip, and the "Saved as a shareable link" note beside it, count the **committed** set only —
`FilterPanel`'s `appliedCount` is read from `appliedFilters`, never from the draft. Both describe
the list as it currently stands and the URL that reproduces it, so a criterion typed into the grid
contributes nothing until Apply has put it in the URL, and both disappear again on Reset. The same
holds in Logs, where `AuditFilters` takes the committed set as a prop of its own for this.

**Committed criteria are read from, and written to, the URL entirely through `nuqs`.** Each
section's `*-search-params.ts` declares one nuqs parser per key — `parseAsStringLiteral` for a
closed vocabulary (`status`, `actorType`, `occurredPeriod`), `parseAsTrimmedString`
(`src/lib/search-params.ts`) for free text, which trims and turns a blank result into absent, and
a small `createParser` for the page, the two `occurredFrom`/`occurredTo` bounds, and
`workflowVersion` — and both hooks read the committed set with
`useQueryStates(parsers, { history: 'replace', shallow: false })` rather than `useSearchParams`.
`shallow: false` is required, not stylistic: without it a commit is only a `history.replaceState`
write that react-router never observes, so `useLocation()` goes stale and `AdminLayout`'s
remembered per-section search sends an operator back to the filters they had _before_ their last
Apply. `throttleMs` keeps nuqs' default, which guards Safari's rate limit on `history` writes and
delays only the URL write — the state the hook returns, and the query key built from it, update on
the spot. A tab link is built from the same parser map through nuqs' `createSerializer`, so a
committed URL and a tab link are always produced by identical code. Validation is two layers, one owner each: nuqs validates
each key at the URL boundary — including `workflowVersion`'s own parser, which rejects anything
that is not a positive whole number — and **an unrecognized or unparseable criterion now falls
back to that key's default on its own, while every other criterion in the URL still applies** —
`?workflowVersion=abc&status=active` applies `status` and shows the default workflow version, and
`?actorType=nonsense&action=x` keeps `action`. This is a deliberate reversal of the panel's
previous behaviour, where one invalid criterion reset the entire filter set; a hand-edited or
stale shared link now degrades gracefully instead of blanking every criterion. The one rule no
single key's parser can express — `occurredFrom <= occurredTo` — is plain TypeScript in
`filter-audit-events.ts`, read two ways: `findOccurredWindowError` gives `AuditPage` the message it
shows inline and refuses to Apply on, and `toAuditEventQueryFilters` drops a window it refuses back
to absent, so a URL stating a backwards one narrows nothing by it while every other criterion still
applies. Onboardings has no cross-field rule, only three single-control predicates —
`isRequestableWorkflowVersion`, `isRequestableConnectorId` and `isRequestableParkedBefore` — folded
by `findDraftError` into the one refused field and message `OnboardingsPage` blocks Apply on and
the panel's single message element (`#onboarding-filters-error`) describes; each shares its
validity check (`isValidWorkflowVersion`, `isValidConnectorId`, `toIsoInstant`) with the URL's own
parser for that key, so a control and the URL cannot disagree about what is requestable. Absence has one representation throughout,
`null`: a criterion the URL omits, states blank, or states unparseably reads as `null` and stays
`null` into the axios `params`, which drops it — axios would send `''` as a bare `key=`, so blank
has to resolve to absent at the boundary rather than be filtered out downstream. Zod plays no part
in either section's filter path, only in response-payload validation under `api/*.ts`. See
`docs/decisions/0018-nuqs-for-admin-panel-search-params.md`. `NuqsAdapter` (from
`nuqs/adapters/react-router/v8`) is mounted in `src/app/App.tsx` as the data router's root route
element, wrapping an `<Outlet />`, not in `AppProviders` — the adapter reads react-router's own
hooks, which `AppProviders`, rendered above the router, cannot give it. The router is built with
`createBrowserRouter` inside a component under `AuthGate`, so pages can call `useBlocker`
(`docs/decisions/0050-admin-panel-data-router.md`).

The page header carries the design's **Export CSV** button: an outline button with a download icon
calls `GET /v1/onboardings/export` with the applied filters (never the draft, and without
`page`/`limit`), so the file matches the list on screen across every page. It is rendered only
once a list fetch has succeeded — hidden while the list is loading or after it failed to load — and
is labelled with that list's `pagination.total` (`Export 41 as CSV`), which is the export's row
count for the same criteria. It is disabled while a request is in flight, while a draft filter
is refused (`findDraftError`) and when the total is zero, and reads `Exporting…` meanwhile. The download goes through axios as a blob (`fetchAdminOnboardingsCsv`,
`useOnboardingsExport`) because a navigation could not carry the Entra bearer token; a failure is an
`Export failed` toast, and since a broken connection rejects the request, no truncated file is ever
saved. The panel names the file itself, `onboardings-<yyyy-MM-ddTHH-mm>.csv` in local time (`toDateTimeLocalValue`, `:` swapped for `-`), and does
not read `Content-Disposition`.

Two things the design draws are deliberately absent, each for want of an endpoint: the applicant
column of masked contact details and per-status counts on the inactive tabs. A third, the "Started"
date range, is absent because `ListAdminOnboardingsQueryDto` accepts no date
criteria — `createdAt` is returned and is the query's primary sort key, but nothing filters on it.
Workflow and version stay free-text inputs rather than the design's dropdowns — turning them into
one is out of this change's scope, even though `GET /v1/admin/workflows` (§12, below) now exists to
populate one. The `workflowId` parser is shared rather than duplicated: it moved to
`src/lib/onboarding-search-params.ts`, the same module the Workflows page's In progress link
serializes with ([0032](decisions/0032-admin-workflows-list.md)).

The onboarding details page (`/onboardings/:id`, `src/app/onboardings/details/`) is the design's
tabbed run view, not a smaller copy of the list's bands. Its header band is its own rather than the
shared `PageHeader` every section page renders (above), because it says more than a title: a
breadcrumb back to the list carrying
the search string it was opened from, the id as a monospace `h1`, a status `Chip`, the
`Workflow <id> v<n>` line, linked to `/workflows/<id>?version=<n>` so the workflow page opens on the
version this onboarding is pinned to (the `version` param is declared once in
`src/lib/workflow-search-params.ts` and spread into the details page's parsers) — and the
action cluster, Approve / Reject / Mark invalid (`OnboardingReviewActions`, gated on the pinned
workflow definition's current step — [0021](decisions/0021-admin-panel-issues-manual-review-decisions.md))
plus a Reload icon button. While the summary carries a `pendingConnector` — the engine's record of
the connector the onboarding is parked on, `null` otherwise and also `null` from an engine build
that predates the field — the cluster leads with **Check provider** (`OnboardingReconcileAction`),
which posts `POST /v1/onboardings/:id/pending-connector/reconcile` through
`useOnboardingReconcile`. The engine answers with the summary as it now stands, so the hook writes
it straight into the detail query with `setQueryData` rather than re-reading it, then invalidates
the transitions, the onboardings list and the audit trail (every outcome writes an audit row); the
toast names the outcome — `applied` "Verdict applied." and `superseded` "Onboarding moved on." as
success, `still_pending` "Provider has not decided yet." as a progress toast, since the provider is
still working. A refusal raises the error toast with the message, and a 409 — no longer parked, or
an adapter that cannot reconcile — invalidates the detail, list and trail like a review decision
does. A review decision and a provider check both move the same onboarding, so the header holds
every action and Reload while either is in flight. A review decision invalidates the onboarding's detail (transitions
included), the onboardings list and the audit trail, on success (through
`onboardingMutations.review`'s meta) and on a 409 (in the hook, from the same
`reviewInvalidationKeys`) only; nothing is
removed from the cache, so a list or Logs page no longer on screen keeps its rows, marked
invalidated, and is refetched when it next mounts; Reload stays disabled while
a decision is in flight. Beneath it, `OnboardingRunMeta` is a `MetaStrip` of Started, Last update,
an amber-highlighted `In <step>` while one is current, `Parked on <connector name>` with how long
it has waited (from `parkedAt`, or from `updatedAt` for a park the engine recorded before it
stamped the instant) while a `pendingConnector` is set, Total and Expires, each read from
`createdAt`, `updatedAt`, the most recent transition and `completedAt`/`expiresAt`; an item with no
value — no current step, no expiry — is omitted rather than shown as a placeholder. A
`?tab=history|scores` strip (`utils/details-search-params.ts`, `nuqs`, 0018) switches between
History — the path taken as a horizontal chain of step cards (`OnboardingPathStrip`, replacing the
former React Flow state graph) followed by an activity log (`OnboardingActivityLog`) reading
`GET /v1/admin/audit` filtered to `resourceType=onboarding` and the onboarding's id, with its own
small projection of the audit row shape rather than an import from `src/app/audit/` — and Scores, a
`DefinitionList` of each score against the definition's declared bounds, offered only when the
onboarding carries scores (the engine seeds every declared score at its `min`, so an empty map means
the workflow declares none) — otherwise the tab is absent and `?tab=scores` falls back to History.
The open tab's content is
picked by a `switch` over that literal, so a tab added to `ONBOARDING_DETAILS_TABS` does not compile
until it is given something to render. The activity log's "See in Logs" link is serialized from
`auditResourceSearchParams` (`src/lib/audit-search-params.ts`) rather than concatenated: those two
parser declarations are the one statement of how `resourceType` and `resourceId` are named, spread
into the Logs route's own `auditEventsSearchParams`, so a link and the page it opens cannot drift
apart. The activity log reads `auditQueries.list` from `src/api/audit/`; everything else the two
routes share about the trail is declared once outside both — `ONBOARDING_AUDIT_RESOURCE_TYPE` beside those parsers,
the endpoint beside its fetch function in `src/api/audit/audit-events.ts`, and the metadata
value formatter in `src/lib/audit-metadata.ts`, which the Logs table's `AuditMetadata` renders
from too. The status
chip is shared the same way rather than by a second tone map: `OnboardingStatusChip` moved out of
the list's table row into `app/onboardings/components/`, and the details header renders it at
`size="status"`. The page's status line (`StatusRegion`, inside the header band) reports only what
is
happening to the page and what could not be read — loading, a failed read, an id matching
nothing — and renders not at all once the page is read: what the page holds, each band states
itself, including the caveat that the trail was truncated, which is the "Path taken" caption
rather than a status line of its own. A review decision's outcome is a toast (Toasts, below); the
status line never carries it. There is no Collected-data
tab: `GET /v1/onboardings/{id}` returns the record without its collected data, so the design's PII
sections have nothing to read from. The page draws no workflow graph; `WorkflowGraph` now lives in
`src/app/workflows/details/` and renders on the workflow details page (Workflows, below).

The Logs section is the panel's existing `/audit` route relabelled **Logs** to match the design —
the path, the query parameter names and `useAuditEvents`' contract are all unchanged; the React
Query keys moved to the shared `auditQueries` factory (ADR 0022). It is five bands: the header,
a resource-type tab strip, the filter panel, the scrolling table, and the footer's status line
and pager.

The tab strip sits over `resourceType`, not the design's `API calls / Connector calls / Webhooks /
Operator actions` action families: the engine matches `action` exactly — confirmed against the
running engine, `?action=connector` returns 0 rows — so an action family has no query parameter
behind it. The six tabs (`AUDIT_RESOURCE_TYPES` in `src/api/audit/audit-events.ts`:
Onboardings, Webhook outbox, Callbacks, Connector settings, Admin API, Workflows) plus **All** are the real
`resourceType` values, each a link carrying the committed criteria with `resourceType` set and the
page reset, exactly as the Onboardings status tabs work above. A count is shown on the active tab
only, taken from `pagination.total` — there is no per-resource-type count endpoint, so an inactive
tab carries no number rather than a stale or fabricated one. The Workflows tab is the `workflow`
resource type the engine files connector selections under (§8), and `AuditResourceCell` links such a
row's resource id to the workflow's details page.

`resourceId` is the filter grid's first cell, labelled **Resource ID**. The design's header
search placeholder reads `Action, resource ID, correlation ID`, but that names two separate
exact-match criteria — `action` sits in the filter grid too, a few cells along — and one field,
correlation ID, that `AuditEvent` does not carry at all. `AuditPage`'s `effectiveFilters`
overrides only `resourceType` from the committed set now, not `resourceId`: the tab strip still
needs that override because a tab is a `<Link>` that changes the URL without remounting the page,
so the draft's copy of `resourceType` would otherwise go stale, but once `resourceId` is typed
into the grid the drafted value is the authoritative one, and overriding it would discard every
keystroke. That is also why clicking a resource-type tab leaves a drafted or committed
`Resource ID` untouched.

The table projects `AuditEvent` directly — occurred, actor, action, resource type, resource,
metadata — with four decisions behind that list. The design's `Actor type` and `Actor ID` become
one cell, and its second line is dropped for `system` and `anonymous`, whose ids are placeholders
the engine writes on every such row and so name nobody. A resource id is never truncated, because
it is what an operator copies out of the trail. Metadata cannot be spread across fixed columns at
all, since every action records a different shape; a `connector_settings.*` row says so explicitly,
as the engine records those key names without their values. `Outcome` is absent: `AuditEvent`
carries no such field, and deriving one from `metadata.outcome ?? metadata.status` would read blank
for `onboarding.started`, `onboarding.state_transition` and every `connector_settings.*` row while
implying a field exists, so `Resource type` takes the slot the design gives it.

`AuditTable` fixes the column widths rather than deriving them from content. Metadata is the one
column whose shape changes per action — a webhook payload against `method: GET` — so under an
auto-derived layout the same trail is laid out differently on each page. The other five columns are
sized once and metadata takes the remainder; a viewport too narrow for that scrolls the table
instead of compressing them.

An action reads as a failure when it ends `_failed`, `_rejected`, `_not_found`, `_missing` or
`_unavailable`, or is exactly `onboarding.rejected_attempt` (`isFailureAuditAction` in
`src/lib/audit-actions.ts`, which the details page's activity log colours by too). Two
look-alikes are deliberately excluded: `connector.failure_*`, because `failure_retried` and
`failure_fell_back` are recoveries and the four `connector.failure_*` actions cannot be told apart
by suffix alone; and `auth.access_unauthenticated`, a genuine finding in a deployed environment but
every row of a local stack run with `ADMIN_AUTH_ENABLED=false`.

The Occurred window is one preset select — **All time**, Last hour, Last 24 hours, Last 7 days,
Last 30 days, Custom range… — replacing the former quick-range chip row; `Custom range…` reveals
the two `datetime-local` bounds, the only way to set a closed window. The default is **All time**,
not the design's `Last 24 hours`: a silent default filter would hide rows in a regulated audit
trail, and would change what Reset and the shareable-link model mean.

What that select commits is the **period itself** — `occurredPeriod=24h` — not an instant resolved
from it, following the way Sentry separates a relative `statsPeriod` from an absolute `start`/`end`
pair. The two are mutually exclusive everywhere: in `AuditEventFilters`, in the URL, and in the
request. `occurredPeriod` is one of `1h`, `24h`, `7d`, `30d`, or `custom` for a window stated as
bounds; `custom` is never written to the URL, since carrying `occurredFrom`/`occurredTo` already
says it, and `toAuditEventFilters` derives it back from their presence.

`fetchAuditEvents` resolves the period into `occurredFrom` as each request goes out — the engine
knows only instants, and `ListAuditQueryDto` accepts no period. Resolving there rather than at
commit time is the point of the design: `Last hour` names the hour ending _now_ for as long as the
criterion stays applied, and the React Query key stays `{ occurredPeriod: '1h' }` rather than
changing every minute. The predecessor committed `minutesAgo(60)` as a frozen `occurredFrom` with
an open far end, so a window chosen at noon was silently four hours wide by 16:00 while still
reading `Last hour`; it also made the select drift onto `Custom range…` a minute after a period was
picked, because the selection was re-derived by comparing that frozen string against the clock.

One consequence worth knowing: because a period is relative and the panel does not refetch on its
own (above), a page left open keeps showing the window as it was when last fetched. Apply and
Reload both refetch, which is how an operator brings it current.

The Logs page carries its own list of absences, again each for want of a parameter the audit
endpoint does not accept: **Export** (the audit endpoint has no export route, unlike
`GET /v1/onboardings/export`); **Workflow** and **Version** (`ListAuditQueryDto` declares neither `workflowId` nor
`workflowVersion` — unlike Onboardings, where the two stay free-text inputs, the audit endpoint has
no criterion of any kind for either, so both are omitted outright); **Persona / applicant** (no
applicant projection anywhere in the engine, the same call as the Onboardings applicant column);
the **Outcome** column (reasoned above: no field on `AuditEvent`, and the design's values are
design copy); and the design's four action-family tabs, `API calls / Connector calls / Webhooks /
Operator actions` (replaced by the `resourceType` tab strip above, for the same exact-match
reason).

The Workflows section (`/workflows`, `src/app/workflows/`) is the panel's first read of
`GET /v1/admin/workflows` ([0032](decisions/0032-admin-workflows-list.md)): a new `ADMIN_SECTIONS`
entry, `{ label: 'Workflows', group: 'Build', icon: AccountTree }`, placed first in Build, above
Connectors. It is built like Onboardings — header, filter panel, table, footer — but reads its list
through a plain `useQuery(workflowQueries.list(filters))` called straight from the page rather than
a wrapping hook: there is no commit-triggered invalidation and no hand-derived phase to keep in
sync, so `isPending`/`isError`/`data` from the query result are the page's whole loading, error and
ready story. `WorkflowFilters` carries `TextFilterField` (**Search**, matching `key` or `name`),
`SelectFilterField` (**Scope**, "All" as the any-option; `fixtures` is neither offered nor parsed
from the URL when `VITE_NODE_ENV` is `production`, since that engine never loads it) and the new `CheckboxFilterField` (**Has
unpublished draft**); `search`, `scope`, `hasDraft` and `page` are committed to the URL by
`useWorkflowsFilters`, the section's own nuqs call. The page size is fixed at 20 with no page-size
field and no `limit` param, unlike Onboardings and Logs. Applying an unchanged filter set does not
refetch; Reload calls `refetch()` explicitly. The status line reads "Showing {from}–{to} of {total}
workflows.", narrows to "No workflows match "{search}"." or "No workflows match these filters."
under a search or any other applied criterion, and "No workflows loaded." with nothing applied at
all.

A row's **Workflow** cell links the mono `workflowId` to the details placeholder, with `name`
underneath when the family has one; **Scope** is plain mono text; **Serving** reads a mono "vN" or a muted "Not
served"; **Versions** reads the count with a muted "{n} draft" note; **In progress** links a
non-zero count to `/onboardings?workflowId=<id>`, built by the shared serializer in
`src/lib/onboarding-search-params.ts` (also spread into the Onboardings filters, above), or renders
"—" at zero; **Added** shows `createdAt`'s date, plus an "Edited {date}" line when `updatedAt`
differs from it by date; the trailing arrow column is decorative. The whole row opens the details
page through the `workflowId` link, with the In progress link raised above it (see the stretched
row link below). The details route it points at, `/workflows/:workflowId`
(`src/app/workflows/details/WorkflowDetailsPage.tsx`), is a read-only view of one stored published or retired version
([0033](decisions/0033-admin-workflow-details.md)) and the editor for a draft, registered in `ADMIN_DETAIL_ROUTES` so the
sidebar keeps Workflows active while it is open. It reads `workflowQueries.versions`
(`src/api/workflows/workflow-versions.ts`) for the picker and the status chip, and, in parallel,
`workflowQueries.detail` pinned to `?version=` or unpinned without it, so the engine serves the
highest `published` version. Without `?version=`, a family with no published version opens its draft, if it has one. Once the versions list has settled, a `?version=` the family
does not hold, or no `?version=` with nothing published or drafted, replaces the tabs with "Version N does not exist." or
"This workflow has no published version." and keeps the picker; neither tab renders, and no pinned definition or document
is read. A list served from cache that lacks the pinned version is re-read once first, since a
version may have been published elsewhere since; the page shows its loading state meanwhile. A 404 on the definition read itself, the list being stale, gives the same message inside the Compiled graph tab. A
`retired` version is listed and selectable. `version`, `step` and `view` live in the URL (nuqs, `history: 'replace'`, `shallow: false`); an
unknown `step` falls back to the definition's `initialStep`, and switching version clears `step`
and `view`, so every version opens on its initial step and its default tab. `?view=authored|compiled|json`
picks the tab (`VersionTabs`, Base UI `Tabs`: "Authored graph", "Compiled graph", "JSON"); a published
or retired version defaults to `compiled` and a draft to `authored`. The former `?view=graph` is an alias
for `compiled`, so old links still open the compiled graph; any other value falls back to the default.
The "Authored graph" tab of a published or retired version is `VersionCanvas`, the same `AuthoredCanvas`
read-only, over `workflowQueries.document`, fetched once the tab mounts. The header (`WorkflowDetailsHeader`) puts the breadcrumb
and the title, which wraps, on the left, and under the title a line with the version's status chip, the editor's note and the
onboardings link; on the right the version picker sits above the `actions` row, which wraps onto further rows when the title
column reaches its minimum width rather than dropping under the title. On that line, a "View onboardings →" link, the
onboarding details header's Workflow line mirrored, links to `/onboardings?workflowId=<id>` through
the same shared serializer — the workflow only, never the shown version, and only once the versions
have loaded. It is hidden on a draft, which cannot start an onboarding. It sits there rather than among the header's controls, which the design reserves for the
picker and Edit as draft. The graph, with the
inspector, is `VersionGraph`, which draws `WorkflowGraph` under `src/app/workflows/details/components/` (dagre, top to bottom), with selection
controlled by intercepting React Flow's node `select` changes. `WorkflowZoomControls` (zoom out, zoom level, zoom in,
Fit) float in a React Flow `Panel` at the canvas's top right, so the draft graph has them too and the stats band above
holds only the counts. When one authored step compiled to several steps, the compiled graph draws a dashed
frame around them (`WorkflowGroupNode`), tinted by the step type's category and labelled
`<step> · <type>`; the frames come from each compiled step's `source`, and a workflow with none lays
out as before. The inspector names the same source under the step's name, as `From <step> · <type>`, with no friendly type label. Every edge except a plain, unguarded `success` carries a label
(the condition, the `manual.*` action, the status with its reasons, or `<status> · fallback`),
capped at 22 characters and expanded in place on hover or focus while kept inside the canvas; the
selected node is drawn with an outline, so its content never shifts. From the `xl` breakpoint the
graph and inspector sit side by side and only the inspector scrolls; below it they stack and the
area scrolls as a whole. On the JSON tab of a published or retired version, `VersionDocument`
(`components/VersionDocument/`) reads `workflowQueries.document` only once the tab mounts and shows
the stored document in a read-only `JsonEditor` (`components/JsonEditor.tsx`, shared with the draft
editor; read-only is CodeMirror's `EditorState.readOnly`, so Backspace and Delete change nothing), with
a **Copy JSON** button that toasts "JSON copied." or the clipboard's failure, including a missing
`navigator.clipboard` outside a secure context. While the unpinned
definition is still loading the JSON tab shows "Loading version…", and a failure of that read the Compiled graph tab's failure
with Retry. App-wide, the `--font-display` and `--font-body` stacks in
`tailwind.css` name `Inter Tight Variable` ahead of `Inter Tight`, the family the self-hosted
variable font registers. The inspector beside it shows the selected step's fields,
connectors (identity and field mapping) and outgoing transitions. The inspector omits connector
`config`; the JSON tab shows the stored document, `config` included (0041). Its one editing control is the connector binding, offered only on a published (or unpinned)
version; a draft or retired version shows none. For a step's primary connector `StepConnectors`
renders a native `<select>` of `selectableIds` — only when more than one adapter can serve the
slot — showing the effective `id`, with `(authored)` after the id the document wrote. Changing it
only sets local state; nothing is saved until a button is pressed, and the select and every button
are disabled while a write is in flight. **Save for v{N}** (enabled when the choice differs from the
effective `id`) calls `PUT /v1/admin/workflows/{id}/steps/{step}/connector` (§11) with
`{ scope: 'version', version: N }` through `workflowMutations.selectConnector`, whose meta awaits
every read of the family, so the outcome resolves once the new slot is on screen. **Apply to all
published versions** appears when the connector's `versions` has two or more entries, is enabled
while some entry's `id` differs from the choice, and sends `{ scope: 'all' }`. While `selected` is
true a quiet **Restore on v{N}** calls the `DELETE` with `scope=version` (`workflowMutations.clearConnector`,
same meta), and **Restore on all versions** appears when two or more versions are covered and one of
them is selected, with `scope=all`. The card's helper text reads "Saves for this version, or for
every published version with this step. Drafts and newly published versions run their authored
connector. Onboardings already waiting on the previous connector finish with it." Each outcome is a toast (Toasts, below): "Connector set to {id} on v{N}" (or "on v1, v2"),
"Authored connector restored on v{N}" (or "on every version"), and "Unable to change connector" reading `Version N refused: …`
(`describeConnectorSelectionError`), where `N` is the `workflowVersion` the engine named and the
rest is the engine's `detail` when it sent one — it names the missing field or the offending config
key — else the panel's sentence for the `reason`, one per reason the engine declares, else the
engine's own message for a reason this build does not know. The "→ Global settings" link keeps the
effective id. Import JSON, every publish, retire or scheduling action and
the visual canvas the design draws are dropped; the design's "24 workflows" count beside the filter
actions is dropped too, since the footer's "Showing x–y of n" already states it.

Drafts are authored in the panel. The temporary banner that said the section was read-only is gone
from `WorkflowsPage`; the `Callout` component stays. The drafts API is `src/api/workflows/workflow-drafts.ts`:
`createWorkflowDraft` (`POST /v1/admin/workflows`), `fetchWorkflowDocument`
(`GET .../versions/{v}/document`, returning a `WorkflowVersionDocument` of any status), `updateWorkflowDraft` and `deleteWorkflowDraft`
(`PUT` / `DELETE .../versions/{v}`) and `compileWorkflowDocument`
(`POST /v1/admin/workflows/compile`, returning `stepCount` and the compiled `workflow`, which the draft's graph renders). A failure is an `ApiError` carrying `status`, `code` and the
raw `body`; `readDraftError` parses the body's `code`, `reason` and `path` for a code the engine
names, and returns `null` for any other failure. The user-facing text per code is
built in the routes (`utils/describe-draft-error.ts`), not in `src/api/`. Each workflow key is its parent key plus its own params, so invalidating
a key reaches every query below it: `detailsFor(id)` holds `versions(id)` and `detail(id, v)`, and
`document(id, v)` is `[...detail(id, v), 'document']`. `detailsFor(id)` invalidates a whole family,
`detail(id, v)` one version's definition and document. `fetchWorkflowDefinition(id, version?)`
reads `GET .../versions/{v}` when pinned and `GET /v1/admin/workflows/{id}` when not, since
`?version=N` no longer exists; its signature and callers are unchanged.

**New draft** is a primary button in the list's `PageHeader` that opens `NewDraftDialog`
(`src/app/workflows/components/NewDraftDialog/`, Base UI `Dialog`). "Start from" offers three options,
**Fork an existing version** (the default), **Empty workflow** and **Upload a definition file**.
**Empty workflow** takes Workflow ID, Version (integer from 1, default 1) and an optional Name
through react-hook-form, and posts `{ id, version, name?, steps: [] }`. **Upload a definition
file** reads a `.json` file with `File.text()` and `JSON.parse` (`parseDraftUpload`);
the document is validated in the editor, not on upload, so only a parse failure, a non-object or a
missing `id` or `version` is rejected, as field validation. A read file prefills editable Workflow ID
and Version fields, plus an editable Name prefilled from the file's `name`, and the document is posted with
those values in place of its own; an empty Name removes `name` from it, also in a fork.
**Fork** copies a published or retired version into a new draft
([0043](decisions/0043-forking-a-version-is-a-client-side-copy.md)); the engine does not change.
`ForkSourceFields` holds a **Source workflow** `Combobox` and a **Source version** `Select`. The
combobox searches `workflowQueries.listPages` (`limit 20` a page, `search` debounced 300 ms by
`useDebouncedValue`) and keeps only families with a published or retired version
(`versionCount - draftCount > 0`), built-in and fixture families included. The endpoint cannot
leave draft-only families out, so the next page loads on its own while fewer than 20 forkable
families show, and again when the list is scrolled to its end; the empty row shows only once
every page is read. Choosing a family reads
`workflowQueries.versions(id)`; the select offers its non-draft versions as `vN — status` and
defaults to the latest published one, else the latest retired (`defaultForkVersion`). Choosing a
version reads `workflowQueries.document(id, v)` and prefills the form; choosing the
selected one again, or leaving Fork for Empty and coming back, keeps the operator's edits; coming back from a read upload clears the upload and prefills the source again. A `users` family keeps its ID and takes Version `max + 1` over every listed
version of any status (`nextWorkflowVersion`); a `built-in` or `fixtures` family gets an empty
ID, the hint "Built-in workflows are copied under a new ID, with their connector source keys
renamed." and Version 1, since a new ID is a new family. Name comes from the document, and editing
the ID never changes the Version. A hint, "Changing the ID creates a new workflow and renames its
connector source keys.", sits in the ID field's hint slot for a `users` source.
While a chosen source's reads load, including the lookup of a preselected family, the identity fields and Create are disabled and the combobox shows its loading row; a late document never prefills while another source is chosen. A failed read shows a
`StatusRegion` with Retry. The **draft-exists guard** fires when the trimmed ID equals the
source's and its versions list holds a draft: a notice band (`role="status"`) above the ID row reads "This
workflow already has draft v{N}. Open it, or change the ID to create a new workflow." with "Open
it" linking to `/workflows/<id>?version=N`; the footer's primary action becomes **Open draft v{N}**
(a link to the same path), Create is disabled and outlined; the engine's
`409 WORKFLOW_DRAFT_EXISTS` toast stays as the fallback. The schema's `fork` arm posts
`{ ...fork.document, id, version, name? }`. Under a new ID it first renames the `sourceKey` the engine reads —
`config.sourceKey` of a `kyc-identity-verification` step, and `config.sourceKey` of each connector and
its `fallback` entries on a `custom` or `connector-call` step and on a `notify` step's `connector` (`renameSourceKeys`) — to one derived from that ID — `my-flow` → `my_flow`, then `my_flow_2`
for a second distinct key — since only one workflow id may own a key and the copy would otherwise
fail its first publish with `409 WORKFLOW_SOURCE_KEY_CONFLICT`; steps that shared a key still share
one, and a fork under the same ID keeps its keys. It rejects a form with no source ("Choose a workflow
and a version."). All three sources validate through one
`zod` schema, `utils/new-draft-schema.ts`, wired with `zodResolver`
([0035](decisions/0035-zod-schemas-for-client-validated-forms.md)): the engine's save
precondition (`id` of 1–100 characters, `version` from 1 to 2147483647) is stated once there and
shared by the typed fields and the uploaded or forked document, and the schema's output is the document
posted, so submit does no assembling of its own. On success the dialog toasts,
invalidates `workflowQueries.lists()`, `versions(id)` and `detail(id, v)`, closes and navigates to
`/workflows/<id>?version=<v>`; on failure it shows an error toast and stays open with its input.
`steps: []` does not compile (`INVALID_VALUE`, `steps`); a draft may be invalid by design.

The same **New draft** button sits in the details header of every published or retired version, in
every scope; a draft's actions still come from `DraftEditor`. `WorkflowDetailsPage` renders
`<NewDraftDialog initialFork={{ workflowId, version }} />`, which opens the
same modal on Fork with that family and version chosen and prefilled by the rules above. The engine
has no per-family summary read, so the scope and the combobox label come from
`workflowQueries.list({ limit: 100, search: workflowId })`, matched on `workflowId` exactly. The
`search` is an `ILIKE` on `key` or `name`, so a family whose ID is matched by more than 100 others
falls outside that page; the combobox then starts empty and the operator picks the family by hand.
The button still shows when the family has a draft, and the guard covers it.

The dialog's pickers are Base UI wrappers in `src/components/ui/`
([0031](decisions/0031-base-ui-toasts-for-admin-panel-mutation-outcomes.md)), generic and unaware of workflows.
`Select` is controlled, takes typed `{ value, label }` items and is styled like the native select
(`h-10`, mono text). `Combobox` is server-driven: the parent owns the input text, the selected
item and the filtering (`filter={null}`), and it shows loading, error and empty rows.

When the selected version is a `draft` (a pinned `?version=`, or the draft a family with no published
version opens on), `WorkflowDetailsPage` renders `DraftEditor`
(`src/app/workflows/details/components/DraftEditor/`) in place of the read-only tabs; it has the same
Authored graph | Compiled graph | JSON `VersionTabs`, defaulting to Authored graph, with the JSON
panel kept mounted while hidden so the editor's undo history survives.
The page's `detail` query is disabled while the pinned status is `draft` or still unknown behind a
loading versions list, so an invalid draft is never compiled for the page. `DraftEditor` reads
`workflowQueries.document` and handles pending, error with Retry and 404 ("This draft no longer
exists."). A document whose `status` is no longer `draft` (published or retired after the versions
list was read) opens no editor: it says so and invalidates `workflowQueries.versions`, and the
refetched list moves the page to the read-only tabs. The text is edited in `JsonEditor`, CodeMirror 6
(`codemirror` `basicSetup`, `@codemirror/lang-json` with `jsonParseLinter`, `@codemirror/lint`),
themed from `@theme` variables. The header's `actions` slot holds, for a draft:

- **Discard** resets the text to the last fetched document; it and Save are disabled while clean.
- **Leaving with unsaved changes** (`UnsavedChangesGuard`, `useBlocker`): a navigation to another
  path or another `?version=` while dirty opens "Leave without saving?" with **Stay** and
  **Discard and leave**; a tab or step change is not blocked, nor is the navigation a successful
  write makes (a save that moves the draft, a delete, a publish), which marks the editor written first;
  the next edit clears that mark.
  A navigation while a validate or save is still pending is blocked. While dirty, a reload or tab close
  gets the browser's `beforeunload` prompt.
- **Publish**, after Save draft, is `variant="primary"` and disabled while a request is pending,
  and while the buffer is dirty. The engine publishes the stored
  row, so only a saved buffer can be published; while dirty, the header note reads "Unsaved changes ·
  save to publish". Click compiles `draft.document` through `compileWorkflowDocument`, with no JSON
  parse step: a failure shows in `ValidationResult` and opens no dialog, and the button stays
  enabled, since every click compiles again. A valid result opens `PublishDraftDialog`, titled
  `Publish {name ?? workflowId} v{version}`, warning "Publishing is permanent: a published version
  cannot be edited or deleted." and "New onboardings will start on this version.", then one
  informational note per primary connector whose other published versions run a selected connector
  that differs from the draft's authored one ("Step `submit_kyc` runs sumsub_kyc on v1, v2
  (selected). v3 will run its authored veriff_kyc."), with Cancel and Publish ("Publishing…" while
  pending). `DraftEditor` reads the draft's own definition (`workflowQueries.detail(id, version)`,
  enabled while the dialog is open) and `describePublishConnectorNotes` builds the notes; while that
  read loads or fails the dialog shows none, and a note never disables Publish. Success toasts "Version N published." and navigates with
  `replace` to `/workflows/<id>?version=<N>`, where the page, with `versions(id)` awaited by the
  factory, shows the published version read-only. `usePublishDraft` removes the draft's
  pinned `detail(id, N)` read, exact so `document` stays, once the editor unmounts after that
  navigation, so the published version's graph does not reuse it. Failure shows an error toast and closes the
  dialog, leaving the draft as it was.
- **Validate** runs `JSON.parse` (a syntax error shows without calling the engine), then
  `compileWorkflowDocument`. The result renders inline under the editor in `ValidationResult`,
  not as a toast: "Valid · N steps", or the code, reason, path and message. The next edit clears it.
- **Save draft** parses, sends `updateWorkflowDraft`, toasts and invalidates `lists()`. A draft
  that stayed put invalidates its own `detail(id, v)` and `versions`, never its family's other
  versions. When `id` or `version` changed, it invalidates the new location's `detail(id, v)` and
  both versions lists, navigates with `replace` to the new `?version=`, and removes what no longer
  exists: the old `detail(id, v)`, or the whole old family when the rename emptied it (the engine
  deleted it).
- **Authored graph tab** (`DraftCanvas`, over `AuthoredCanvas`) edits the draft's authored document;
  see "The draft canvas" below.
- **Compiled graph tab** (`DraftGraph`) draws the compiled `workflow` of the shared compile result, with
  `?step` selecting a step as on a published version. Its inspector is wholly read-only:
  `StepConnectors` gets `readOnly`, so no connector `<select>` or Restore button is
  offered, since a selection binds published versions, never the draft's text; the
  header reads "Read-only here — edit the draft, connectors included, on the JSON tab". It never compiles while typing: when the tab
  opens with no result held it runs the same compile as Validate, and shows "Compiling…" meanwhile;
  a syntax error or an engine refusal shows "This draft does not compile. Fix it on the JSON tab."
  with a Show JSON button, while a failed request (auth, network, 5xx) shows "Unable to compile
  this draft" with a Retry that drops the held failure and compiles again. The result is shared with Validate, Publish and `ValidationResult`, kept
  only while the text is unchanged, so an edit or Discard clears it and drops a compile still in
  flight. The graph is never stored
  ([0041](decisions/0041-admin-workflow-documents-for-every-status.md)).
- **Delete draft** (`DeleteDraftAction`) is the two-click inline confirm of `ReencryptAction`
  ("Delete draft" then "Confirm delete"). It navigates to `/workflows/<id>` when the family has
  other versions, and to `/workflows` otherwise, then removes the deleted `detail(id, v)` — or the
  whole family, when it was the last version — and invalidates the versions list of a family that
  remains.

**The draft canvas**
([0051](decisions/0051-admin-panel-graph-workflow-editor.md)). `AuthoredCanvas`
(`details/components/AuthoredCanvas/`, React Flow) draws the authored document and holds no state of
its own: every edit hands the whole next document to `onChange`. `DraftCanvas` parses the editor's text
(`parseDocument`), passes `doc`, `readOnly={false}`, `failure` and the undo and redo props, and writes
each change back as `JSON.stringify(next, null, 2)` into the same text the JSON tab edits, so Save,
Validate and Discard need nothing new. Text that is not a document shows "Fix the JSON to see the
canvas" instead.

- **Mapping.** A node is an authored step, an edge a wired port (`edges.<port>`, or a condition arm
  or transition). A step's position is `meta.position` (`{ x, y }`, snapped to an 8 px grid);
  `meta` is carried and never read by the engine. A step with none is placed by the layout, so a
  hand-written document opens laid out. Once any step has a position, every canvas edit writes one for
  every step at its shown spot (`pinPositions`), so undo restores a whole layout, never a mix. A
  hand-written `meta.position` is overwritten when that step is dragged.
- **Layout.** `canvas-layout.ts` ranks steps with dagre and re-places each rank under the ports that
  lead to it; `edge-routing.ts` routes edges orthogonally, with retry loops on the right. The
  toolbar's **Auto-arrange** lays out again and, when the document has positions, writes the new
  layout to every step's `meta.position`.
- **Editing.** The palette lists every registered step type by category (click or drag to add).
  A clicked step goes under the selected one, or mid-pane, and the canvas pans only when it lands
  out of view; a dropped step stays where it was dropped, and a drop never pans. Dragging from a port wires it, the step panel and each port's `Select` rewire it, and Backspace or
  Delete removes a step or edge; deleting a step also drops the `agreements` that name it. A
  composable type dropped on a collect step, or picked in its "Include a section" select, becomes a
  section; each type appears once per step, the step's own type included. Node
  summaries show the terminal outcome, the connector id, or the status and field count, and a
  `scores: risk, trust` line when the step has scoring rules. Undo and redo (`useEditHistory`, up to 100 whole-text versions, edits
  within 500 ms merged) are in the toolbar and on Cmd/Ctrl+Z (redo: Shift+Z or Y). From the
  keyboard, Enter or Space on a focused step opens its inspector, and the arrow keys move the
  selected step, written to `meta.position` once the key is released.
- **Inspector forms.** `SchemaForm` generates each step type's config form from the authored JSON
  Schema (`utils/config-schema.ts`) and writes into the document. They do not use react-hook-form,
  an exception to 0019 for the canvas only. A field's `validation` gets its own editor per field
  type (`SchemaForm/FieldValidation/`).
  - **Boolean:** a choice between any value, must be true and must be false.
  - **Text, number and date:** allowed values are "pick one of" (`oneOf`) or "pick several of"
    (`manyOf`), never both.
  - **Number:** each bound has an inclusive toggle, which switches between `minimum` and
    `exclusiveMinimum` (and the same for maximum).
  - **File:** the size is entered in MB. Image width and height show only while every content type
    is an image; they are dropped when a non-image type is left (on blur) or the last image type is
    removed, never while a type is being typed.

  A connector binding's `id` is a select over the engine's connectors of the binding's type: its
  own `type`, else the slot's `defaultType`, else the slot's only type
  (`SchemaForm/connector-binding.ts`). Fallback entries are narrowed to the primary's type, since
  the compile refuses any other, and their own `type` shows only when it disagrees. Changing the
  primary's resolved type drops every `id` in the chain, because an adapter has exactly one type.

  Each map entry, such as a form's field, is a card headed by its editable name. A rename keeps
  the entry's position and refuses an empty or duplicate name. Renaming a field of a step's own
  `config.fields` is one undoable edit (`renameField`) that also rewrites every reference to it —
  `fieldMapping` sources included — unless another step stores a field of the same name
  (built-in, declared or included; a step that does not compile falls back to its declared
  fields), when only the key changes and the card says "References not updated: another step has
  a field with this name". An `http-call`'s `{{payload.<key>}}` placeholders name payload keys,
  not fields, so a rename never rewrites the request: a placeholder left reading a field that no
  longer exists shows as the step's problem ("payload `<key>` reads missing field `<field>`").

  An `http-call` step's `request` and `response` are only `{ type: 'object' }` in ddl-schema, so
  the panel substitutes its own schema for them (`utils/http-request-schema.ts`, mirroring the
  engine's `http-request-config.ts`). Headers, query and an object body are then edited as key–value
  rows; a body that is an array or a single value keeps the plain JSON editor. Settings whose name
  does not explain them carry one line of help, all written in `constants/config-hints.ts` and
  keyed by owner (step config, connector declaration or field descriptor), step type and key.

  A setting that fails its type's schema gets a red one-line reason under its control, with
  `aria-invalid` and `aria-describedby` on the control. `utils/check-config.ts` checks the config
  against the same JSON Schema the form is drawn from, without `ajv`: `required`, `type`, `enum`,
  `minLength`, `minimum`/`maximum`, `pattern`, `minItems`, `uniqueItems`, nested objects, arrays and
  maps. The reasons are short ("Required", "Must be 100–30000", "Not one of the allowed values"),
  and each failure is keyed by its path in the config (`request.url`, `docs[1].type`). The step's
  problem list names those settings, as `invalid config: channel (Not one of the allowed values)`;
  a config that fails only a rule `parseConfig` holds in code, such as a decision's duplicate
  branches, keeps the bare `invalid config: <CODE>`.

- **Scoring rules.** A step's own `scoring` rules (see "Scoring") are edited in a Scoring section
  of its inspector (`StepPanel/ScoringSection.tsx`), on every step type that takes them: not
  `terminal` or `risk-score`, which `acceptsScoring` reads from the type's `resolveScoringStepKey`.
  A rule is a score `Select` over the root-declared scores, a non-zero whole `add` (negative
  allowed; anything else is flagged and not written) and an optional `when` in the condition
  editor, which offers no score leaf there. While the workflow declares no score the section is one
  line pointing to Workflow settings. Every change is one undoable edit (`setScoringRules`, or
  `setConfigScoringRules` for a custom step's `config.scoring`), and
  removing the last rule removes the `scoring` key. A `custom` step keeps its own rules in
  `config.scoring`, so the section lists those first (then any step-level ones), adds new rules
  there, and the type's settings form leaves its `scoring` list out. A rule naming a score that is
  no longer declared stays, shown as "(not declared)", and the step lists "scoring names undeclared
  score".
- **Agreements.** The root `agreements` (see "Agreements") are picked, not typed. The engine
  accepts any stored boolean of the step's compiled entry step as an agreement's field, but the
  panel offers only consents: on a typed step the booleans a `consents` section builds (the step's
  own type or an `include`), on a `custom` step every stored boolean, since the panel cannot tell a
  hand-written consent from any other flag. The projection lists those as `agreementFields`, plus
  any stored boolean an agreement already names, so an agreement written in JSON on another field
  stays visible and removable. A step with such fields gets an Agreements section in its inspector
  (`Agreements/StepAgreements.tsx`): a "Track `<field>` as agreement" checkbox per field, which adds
  an entry with a key derived from the field name (`termsAccepted` → `terms-accepted`) and shows
  its key box. Workflow settings lists every agreement (`Agreements/AgreementList.tsx`) with a key
  box, a step `Select` over the steps that offer a field (and the agreement's own step) and a field
  `Select` over that step's fields; changing the step picks its first field. A key is checked as the normalizer checks it (`^[a-z0-9][a-z0-9-]*$`, unique;
  restated in `utils/agreements.ts`), and a bad one keeps its reason under the box and is not
  written. An agreement whose field the step no longer stores stays, with a remove button, and the
  step lists `agreement <key>: <field> is not a stored yes/no field` — judged by the engine's rule,
  not the narrower offer. Removing the last agreement
  removes the `agreements` key (`setAgreements`).
- **Ports and fields come from ddl-schema.** `authored-projection.ts` and `compiled-preview.ts`
  call `tryResolveStep` and `tryCompileStep` from `@tsh/ddl-schema/step-types`, per step and in the
  browser, so one broken step blanks only its own preview. The authored JSON Schema comes from
  `@tsh/ddl-schema/workflow-schema` (`getWorkflowJsonSchema`).
- **Problems.** The status box lists every step with problems, each issue in full, and the step
  panel repeats the selected step's issues above its sections. Problems no step owns — an
  `initial` or an agreement naming a missing step — head the list as "Workflow settings", which
  opens that panel. The last Validate failure's
  `steps[i]` path is resolved to a step name (`find-failed-step.ts`) and the node is marked.

The panel imports three ddl-schema subpaths — `workflow-contract`, `step-types`, `workflow-schema` —
and nothing else from ddl-schema or `@tsh/engine`; an ESLint `no-restricted-imports` rule in
`packages/admin-panel/eslint.config.js` enforces it. Each of the three reaches no `ajv`;
`packages/shared/ddl-schema/src/runtime-free-subpaths.spec.ts` checks every subpath except the
root and `workflow-validator`. `step-types/step-compile.ts` holds the compiler's per-step part
and is called by both `workflow.compiler.ts` and the panel.

Each write is its own hook — `hooks/useValidateDraft.ts`, `useSaveDraft.ts`, `useDeleteDraft.ts`,
`usePublishDraft.ts` and `useCreateWorkflowDraft.ts` on the list — that spreads a `workflowMutations` factory
(`src/api/workflows/workflow-mutations.ts`) into `useMutation`, adds the follow-up every caller owes
(toasts, navigation, the cache steps below), and returns React Query's own `UseMutationResult`. A
caller's own follow-up rides on `mutate(…, { onSuccess })`: the editor settles only the text it sent,
the dialog closes itself.

The factory's `meta` ([0036](decisions/0036-mutation-factories-with-invalidation-meta.md)) owns the
invalidations that `(data, variables)` and the factory's `(id, v)` decide, carried out by the
`MutationCache` handler of `createQueryClient()` on success:

- **Create** invalidates `lists()`, `versions(id)` and `detail(id, v)` of the new draft.
  A fork creates through the same factory; its reads (`list`, `versions`, `document`) are plain
  queries and add no invalidation.
- **Save** invalidates `lists()`. A draft that stayed put awaits its own `detail(id, v)` and
  `versions(id)`, so the editor's `onSuccess` runs against the refetched document. A moved draft
  invalidates the new location's `versions(id)` and `detail(id, v)` instead.
- **Delete** invalidates `lists()`.

The hooks keep what reads the cache or the router: the old family's `versions(id)` when
`hasOtherVersions` says it remains, `removeVersion`, the toasts and the navigation. A move and a
delete remove the version only once the editor unmounts (`useRemoveVersionOnUnmount`, the page keys
the editor per version): `navigate()` commits after the mutation's own re-render, and removing
earlier lets the still-mounted editor's document observer rebuild the removed query and fetch it
into a 404. Their shared steps live in `details/utils/draft-cache.ts`.

The Connectors section is a 280px connector-type nav beside a single scrolling column of cards for
the selected type, both built from `GET /v1/admin/connectors` — no filters, no pager.
`groupConnectorsByType` groups connectors by `type`, the connector capability from §2, in
`CONNECTOR_TYPES` order, an empty capability omitted and one this build does not know kept and
appended — the engine owns the set, and dropping a connector an operator must configure would be
worse than an unlabelled heading — and also reports the `CONNECTOR_TYPES` entries no connector
implements, so `ConnectorTypeNav` lists them beneath the populated groups as read-only
`FilterTabNote`s. `app/connectors/types/connector.ts` imports and re-exports `CONNECTOR_TYPES` from
`@tsh/ddl-schema/workflow-contract` rather than copying it, so the capability set has one definition
(see "Connector capabilities are imported, not copied" below). Which type is open lives in `?type=`,
the section's own `useQueryStates` call (`utils/connectors-search-params.ts`) — the third such call
site after Onboardings and Logs, and likewise committed with `shallow: false` (0018): no query, or
a type nothing reports, selects the first populated `CONNECTOR_TYPES` entry
(`findSelectedConnectorType`), and a nav link commits `?type=<type>` the same way a status or
resource-type tab does above. The nav itself is not a new component: `FilterTabs` gained a
`vertical` orientation, defaulting to `horizontal` so the existing tab call sites are unaffected.
`ConnectorList` renders only the selected group. A card is titled by the adapter's `name` and shows
its `id` beneath only when the two differ, since most adapters name themselves after their id, and
its status chip reads `Configured`, `Not configured`, or `No settings` when the connector declares
none at all.

Each card is a form for describing a _change_, not the connector's whole desired state, now built
on `react-hook-form` 7.88.0 (`docs/decisions/0019-react-hook-form-for-admin-panel-forms.md`): one
`useForm` per `ConnectorCard`, keyed by setting name, gives each card's draft structural isolation
— two cards can never share or clobber state — in place of the page's former hand-rolled
`drafts`/`issuesById`/`pendingReseed`/`seededIds` model and its reseed effect, which raced React
Query's structural sharing. Whether a card's own write is in flight is card-local for the same
reason, and disables only that card: a single flag above the list cannot describe two overlapping
writes. Save calls the engine's `PATCH` (§4) with only the keys
`buildConnectorSettingsChanges` finds trimmed-different from `formState.defaultValues` —
`dirtyFields` says _what_ changed but not _whether it may be deleted_, which still needs each
setting's `secret` and `source`, so that function keeps taking the form's values, its defaults and
the connector's settings rather than moving onto RHF's own dirty check. Submit is gated on that
changes map being non-empty, never on `isDirty`, which does not trim; there is no resolver on
these cards — the engine owns connector settings validation (the New draft dialog, whose client
check mirrors the engine's save precondition, is the one form with a `zod` resolver) — and a required setting's client-side
enforcement is scoped to `source === 'unset'` (below); the engine remains the sole authority over
the merged result ([0002](decisions/0002-partial-connector-settings-updates.md)) and over the
pairing rules the panel cannot see. A successful save `reset`s the form
from the _submitted_ values, with every secret mapped back to `''`, rather than from the refetched
connector: `connectorMutations.save()`'s meta invalidates `connectorQueries.lists()` without awaiting it, so at the moment a
card learns its write succeeded the `connector` prop is still pre-save data, and resetting from it
would re-offer the very value that was just saved. A rejected key's issue lands on that field with
`setError`.

A stored secret's box always starts empty, because the engine never returns its value, and leaving
it empty means keep the stored value. An empty box is otherwise indistinguishable from an unset
one, so a stored setting is marked three ways: a `stored` chip, a fixed-width masked placeholder,
and the always-present hint saying what an empty box will do on save. The mask deliberately does
**not** track the real value's length — the engine never sends it, and sending it would leak the
size of a credential for no operator benefit. Every setting box is one of `components/ui/form/`'s
two typed fields, `TextFormField` or `SecretFormField`, each wired to the form through
`useController`, with `ConnectorSettingField` composing the connectors-specific chrome around them:
`isRequired`, from `setting.required`, renders the `required` chip first in the label row and sets
`aria-required` on the input, and the `secret` chip and the `stored`/`Not set` hint fill the shared
`FormField` layout's `badges` and `trailing` slots. `SecretFormField` masks by default and sets `autoComplete="off"`
alongside the password managers' own opt-out attributes — this holds a third-party service
credential, not this site's password, so `new-password` would invite a password manager to generate
and save one — with an eye button that switches it to `type="text"` so a long pasted credential can
be proof-read before it is saved;
the toggle reads its own current value from `useController`'s `field.value`, **disabled while the
box is empty**, since the engine returns no stored value and an enabled toggle on a stored secret
could only ever display the mask's own bullets as though the credential really were a row of dots.
Emptying a revealed box falls back to masked for the same reason. The hint is
referenced by `aria-describedby` unconditionally, not only when a write is refused, so a screen
reader is told the engine already holds a credential — it is never sent, so it is never at risk of
being overwritten or dropped. Emptying a _non-secret_ field that had a stored value sends an
explicit `null` for that key. Save is enabled as soon as there is at least one such change — it is
never blocked by a stored secret's box being left empty. Clear is the supported way to remove a
connector's settings — it issues `DELETE` and sits behind an in-card confirmation step, since it is
irreversible. Every setting box renders through `components/ui/Input/`, extracted as a ref-forwarding
component because RHF hands fields a ref a bare class string cannot receive; the panel's filter
controls import it directly, unchanged by the extraction.
Three elements
the design draws are absent because the engine exposes no route behind them —
`connectors.controller.ts` has only `GET /v1/admin/connectors` and `GET`/`PUT`/`PATCH`/`DELETE` on
one connector — so **Test all**, **Test connection** and the whole **Workflow overrides** block are
not stubbed or disabled; they are simply not rendered.

Decisions worth keeping:

- **No automatic refetching.** `retry: false`, `refetchOnWindowFocus` / `refetchOnReconnect` off,
  and `refetchOnMount` true only for a query invalidated while unmounted. Data changes only on
  explicit Apply / Reload / Reset, or when a write invalidates it — at once if on screen, otherwise
  on its next mount. Staleness is expressed only by invalidation. `removeQueries` drops only what
  a write has just deleted, after the screen has navigated away from it — a gone resource, never
  data still shown. For an operator tool looking at regulated data, a silent
  background refresh that moves rows under a cursor is a defect, not a feature. The one bounded
  exception is the Encryption page: while a change is in flight — a key pending activation or
  retirement, or rows the sweep has yet to move — `useEncryption` polls the state every few seconds
  so the operator can watch the sweep converge, and stops the moment it settles. That page shows
  counts and a key history, not rows under a cursor, so the concern above does not apply. Its
  automatic-rotation select is the one control there applied on the first change rather than behind
  a two-click confirm: choosing a schedule is not itself the destructive act, and the sentence
  under it says when the rotation it causes falls due — at once, when the chosen interval is
  shorter than the active key's current age.
- **Zod-validated, explicitly projected responses.** `projectAdminOnboardingSummary` copies exactly
  the lifecycle-safe fields and drops everything else, so a future engine field (notably `context`)
  cannot reach the browser by accident.
- **One set of list components, shared by both lists.** `FilterPanel` and its fields, the
  `DataTable` primitives, `Pagination` and the `TableResults` band that composes them live in
  `src/components/ui/` and are rendered by Onboardings and Logs alike, so a change to how a
  filtered list reads applies to both. The filter grid uses the design's own
  `repeat(auto-fit, minmax(190px, 1fr))` rather than a computed column count: a fixed count paired
  with that 190px floor clipped the last criterion off-screen below roughly 1160px, since the panel
  had no way to reflow.
- **A whole-row link that stays one `<a>`.** `LinkedRow` and `RowLink` in `DataTable` stretch the
  row's identifier link over the row with an `::after` overlay, so a click, middle-click or "Open in
  new tab" anywhere on an Onboardings or Workflows row behaves as the link itself, while the table
  stays valid HTML and assistive tech meets one link per row, named by the identifier. The `<tr>`
  anchors the overlay with `translate-0`, not `relative`: Safari 26.6 computes `position: relative`
  on a table row as `static`, which stretched every row's overlay over the page and sent each click
  to the last row, while a translated row is a containing block there as in Chromium. A row click
  handler was rejected because it fakes a link: no new tab, no URL preview.
  Another link in the row takes `relative` to paint above the overlay; the cost is that a cell's text
  cannot be drag-selected, and the trailing arrow is decorative rather than a second link.
- **One underlined in-app link.** `TextLink` (`src/components/ui/TextLink/`) is the design's link
  with a grey underline that darkens on hover, built on `Typography` in `body-sm` or `mono`. The
  Workflows list's In progress count, the workflow details "View onboardings →" line and the
  onboarding details Workflow line all render through it; a breadcrumb's hover-only underline is a
  different style and stays out of it.

- **A fixture-driven e2e harness.** `e2e/run-direct-engine-playwright.cjs` boots
  `test-engine-fixture.cjs`, writes a `.env` pointing the panel at it, then runs Playwright. The
  panel's browser tests exercise the real request path without the Docker stack. Playwright is
  spawned as its own CLI — resolved from `@playwright/test` and run with the Node executable
  already running the harness — rather than through the package manager, because
  `node $npm_execpath exec playwright` assumes the package manager is a JavaScript file and a
  standalone pnpm (`@pnpm/exe`) is a native binary.

- **Configuration is read at runtime, not baked in at build time.** Vite inlines
  `import.meta.env.VITE_*` when the panel is built, which would otherwise mean one image per
  environment. `readRuntimeEnv()` (`src/config/runtime-env.ts`) instead merges
  `window.__ENV__` over `import.meta.env`, dropping any key whose value is an empty string or not a
  string so an unset variable falls through rather than shadowing the build-time one. In the
  container, the engine serves `/config.js` itself, rendering `window.__ENV__` from its own
  configuration on every request (`packages/engine/src/admin-panel/admin-panel-runtime-config.ts`),
  so the same image serves any engine URL or SSO config a deployment's Compose `environment:` block
  gives it, and a `.env` change takes effect on restart with no rebuild. Values are embedded with
  `JSON.stringify`, so nothing in a configured value can break out of the object literal. A key
  that is unset, empty or blank is omitted rather than written as `""`, because `readRuntimeEnv()`
  drops empty values anyway. `VITE_ENGINE_API_BASE_URL` defaults to `/`: the panel is served from
  the engine's own origin, so a relative base URL is correct however the deployment publishes it,
  and an absolute one would break the moment `ENGINE_PORT` was remapped. `VITE_NODE_ENV` and
  `VITE_ENVIRONMENT_NAME` are the derived keys: always the engine's own `NODE_ENV` and
  `ENVIRONMENT_NAME`, never read from variables of those names, so they need no Compose or
  `.env.dist` entry and cannot disagree with what the engine loaded. Under `pnpm dev` and in
  Vitest, `window.__ENV__` is never set, so `import.meta.env` alone decides behaviour — unchanged
  from before this mechanism existed.

- **One status list per package.** `ADMIN_ONBOARDING_STATUSES` in
  `src/api/onboardings/admin-onboardings.ts` holds the five statuses the engine emits, and
  the Zod response enum, the filter normalizer's guard, the status tab strip and the row chip all
  read it. The label map is typed `Record<AdminOnboardingStatus, string>`, so adding a status fails
  the build rather than leaving that status unfilterable or unlabelled. The panel keeps its own copy for now rather than
  importing `WORKFLOW_STATUSES` from `@tsh/ddl-schema`; moving it to an import under the new rule
  is a pending follow-up (ADR 0051). The two `.cjs` e2e harness files carry a
  third copy for the same reason — they are plain CommonJS and cannot import the TypeScript module.

- **Some domain lists are imported, not copied.** The panel may import `step-types` and
  `workflow-schema` as well (ADR 0051); the draft canvas does (see "The draft canvas").

- **Connector capabilities are imported, not copied.** `CONNECTOR_TYPES` is the one domain list the
  panel does _not_ restate: `src/app/connectors/types/connector.ts` imports it from
  `@tsh/ddl-schema/workflow-contract`, and the connectors page groups by its declaration order. That
  subpath is constants and types with no runtime dependencies, so nothing else — `ajv` in
  particular — reaches the browser bundle; importing the package root would. Only the operator-facing
  labels stay local, typed `Record<ConnectorType, string>` so adding a capability upstream fails the
  panel's typecheck until it is given one. This is a deliberate exception to the status list's
  copy-it-locally rule above, taken because a silently drifted capability list would leave a
  connector ungrouped rather than merely unfilterable.

- **Toasts are the only channel for a mutation's outcome**
  (`docs/decisions/0031-base-ui-toasts-for-admin-panel-mutation-outcomes.md`). Built on
  `@base-ui/react`'s `Toast`, mounted once by `Toaster` in `AppProviders` around the whole tree;
  `src/components/ui/Toast/toast-manager.ts` exposes `showSuccessToast(title)`,
  `showErrorToast(title, description)` and `showProgressToast(title)` over a module-level
  `Toast.createToastManager()`, so a handler outside React can raise one. Three kinds: success
  (teal tile, black `check`, 5 s), error (red tile, white `priority_high`, 10 s, carries a
  description) and progress (`tsh-blue-300` tile, black `sync`, 5 s like success, announced politely like
  success) — progress marks a write the engine has accepted but finishes later in the background.
  A connector save or clear, each of Approve / Reject / Mark invalid, and a provider check raise
  exactly one toast on completion — the check's a progress toast when the provider has not decided
  yet, success otherwise. The Encryption page's toggle and re-encrypt each raise a progress toast the
  instant the engine accepts the write, then a second, success toast once the route's own
  `useSettledChangeToast` hook sees `isEncryptionChangeInFlight` turn `false` for that write —
  never for a change settling with no pending write started from this page, and not once the page
  has unmounted; its rotation-schedule change and add-key finish synchronously and raise a plain
  success toast, like a connector save or a review decision. The stack sits fixed bottom-right and
  uses Base UI's native collapsed stacking: the newest toast is frontmost at the corner, older ones
  peek behind it, and hover or focus spreads them into a list 8px apart. It is capped at three
  (`TOAST_VISIBLE_LIMIT`) — a fourth is kept by Base UI but hidden until one clears. Toasts sit in
  Base UI's own polite `Notifications` region, which announces a success or progress toast; an
  error toast passes `priority: 'high'`, so Base UI announces it once, assertively, through its own
  hidden `role="alert"` — there is no `role` override on the toast box. Success and progress
  dismiss after 5 s; error carries a description and dismisses after 10 s. The progress bar follows
  Base UI's real timer: it pauses on hover, on focus and when the window loses focus, and a toast
  reappearing from behind the 3-toast limit resumes from its remaining time rather than a fresh
  bar; under reduced motion the bar is a static full bar. **Not a toast:** loading, a fetch error
  and the connector count line (or, on the Encryption page, `summarize(state)`) stay in their
  `StatusRegion`; a rejected connector setting stays inline under its field. The Connectors header
  and the details page header no longer show a write's outcome as text — `ConnectorsPage`'s former
  `actionMessage` and the details page's `reviewError` status branch are gone, not merely unused;
  the Encryption page's own `actionMessage` is gone the same way.

---

## 13. Delivery

**Compose** (`docker-compose.yml`): `postgres:16-alpine`, `redis:7-alpine`, `garage`
(`dxflrs/garage:v2.4.1`, a single service — `garage server --single-node --default-bucket` creates
the layout, the `orchestrator-files` bucket and its access key itself on boot and is a no-op once
they already exist, so there is no bootstrap sidecar),
`mailhog` (HTTP UI published; SMTP network-internal only), `engine` (`MODE=api-only`),
`engine-worker` (`MODE=worker-only`, reuses the same image, no separate build),
and `engine-mailhog-test` (a short-lived SMTP integration runner, in the `mailhog-test`
profile so only `pnpm test:mailhog:integration` starts it — see **Keeping the test runner out of
`up`** below). There is no `admin-panel`
service: the panel ships inside the engine's image and is served by the engine itself.
`workflows/users` is bind-mounted read-only at `/app/workflows/users`; `built-in/` and `fixtures/`
ship inside the image. `WORKFLOWS_USERS_DIR` relocates the user scope when it is not that path.

**Image**: one image — multi-stage `node:24-alpine`, non-root `app:app`, `packages/engine/Dockerfile`.
The `build` stage runs `vite build` alongside the engine's own build and the runtime stage carries
`packages/admin-panel/dist` with everything else. Adding the panel cost about **900 kB** and left the
image at 1.37 GB, because its dependencies were already there: the runtime stage copies the build
stage's whole `/app` including `node_modules` (the image also runs jest for the Compose MailHog
suite), and that `node_modules` has always covered every workspace package, the panel included. A
separate build stage copying only `dist/` was tried and reverted for that reason — it duplicated a
full `pnpm install` and excluded nothing. Making the runtime image genuinely lean means pruning that
`node_modules`, which is a separate change and would have to keep the MailHog suite working.

**Serving both halves**: `serveAdminPanel()` (`packages/engine/src/admin-panel/admin-panel-static.ts`)
registers three Express handlers ahead of Nest's router — `/config.js` rendered from configuration
and marked `no-store`; the static build, with `index.html` marked `no-cache` so a rebuild's new
hashed asset names are never read from a stale copy; and an SPA fallback to `index.html` for every
remaining non-API path, so a hard refresh on a client route such as `/audit` resolves. Every engine
route is namespaced under `/v1`, which is what lets the panel own the root without shadowing the
API; a controller mounted outside that prefix would start being answered with `index.html`. When
there is no build to serve — `pnpm start:dev`, the engine's own test runs — all three handlers are
skipped and the engine behaves exactly as it did before. `ADMIN_PANEL_ORIGIN` and the CORS
allowlist remain for `pnpm dev`, where the panel is a separate origin on port 5173; from the image
the panel is same-origin and CORS never enters the picture.

**Panel dev loop against the stack**: because the static handler reads the dist directory from disk
per request, the panel a container serves can be swapped without rebuilding the image.
`docker-compose.panel-dev.yml` is an opt-in overlay that does exactly that — it bind-mounts the
host's `packages/admin-panel/dist` read-only at `/app/admin-panel-dist-dev` and points
`ADMIN_PANEL_DIST_DIR` at it, so the image's own build stays in place rather than being shadowed.
`pnpm stack:panel-dev:up` builds the panel before starting the container, which matters because
`findAdminPanelDist()` probes for `index.html` once at startup and an empty mount would leave the
panel unserved for the container's whole life. It is the one `stack:*` script that does not pass
`--build`: switching into the dev loop should not cost an image rebuild, and Compose still builds
the image on its own when none exists yet. It also names `engine engine-worker` explicitly rather
than bringing up every service: `depends_on` covers the infrastructure anyway, and an unscoped
`up -d` was observed replacing `tsh-onboarding-conductor-engine:local` with a freshly built image,
where the same command scoped to `engine` recreated the container in under two seconds and left
the image untouched — so the narrow scope is what keeps entering the loop cheap. It no longer has
to dodge `engine-mailhog-test`, which the `mailhog-test` profile now keeps out of every unscoped
`up`. `pnpm panel:watch` (`vite build --watch`) then
rebuilds on save; a browser refresh is enough, and the engine neither restarts nor notices. The
overlay is deliberately not `docker-compose.override.yml`, which Compose loads automatically:
`dist` is gitignored, so on a fresh clone that would silently turn every `pnpm stack:up` into a
stack with no panel. Note that `vite build --watch` watches the module graph only — an edit under
`public/` needs a plain `pnpm --filter @tsh/admin-panel build`. This is a development convenience
and changes nothing about how the image ships: `pnpm stack:up` recreates the engine without the
overlay and it serves the baked copy again.

**Keeping the test runner out of `up`**: `engine-mailhog-test` declares
`profiles: ['mailhog-test']`, so no unscoped `up` starts it and `pnpm stack:up` brings up the six
dev services only. Without that profile it ran as an ordinary service on every `pnpm stack:up`,
where it applied migrations to the same `orchestrator` database the engine was migrating, deleted
the `smtp` row from `connectors`, and spent a cold run's ~2 minutes compiling and running a jest
suite across both vCPUs of the local VM. That last part is what actually broke the command: the
starved `engine` took 120 s to finish `onModuleInit` instead of ~2 s, which is exactly the health
budget it had (`start_period: 20s` plus `retries: 10` at `interval: 10s`), so Compose marked it
unhealthy, `engine-worker`'s `service_healthy` dependency failed, and the whole `up` aborted with
`dependency engine failed to start`. The engine's healthcheck was given headroom in the same
change — `start_interval: 2s` reports a normal boot healthy in about two seconds rather than on a
10 s tick, and `start_period: 90s` with `retries: 6` means a slow cold boot no longer sits one
stall away from failing the command. `pnpm test:mailhog:integration` passes `--profile
mailhog-test` explicitly, and every teardown (`pnpm stack:down` and both test scripts' `finally`)
passes `--profile '*'`, because a container from a disabled profile is neither in scope nor an
orphan and a plain `down --remove-orphans` walks straight past it.

**Scripts** — everything goes through root pnpm scripts, never raw `docker compose` / `jest` /
`playwright`. `pnpm test:e2e` (`scripts/test-e2e.cjs`) brings the stack up with `--wait engine`,
stops `engine-worker`, runs `pnpm -r run test:e2e`, and always tears down in a `finally`. The
worker is stopped because it drains the same outbox the engine's suites assert on: without that
step a developer whose full stack is already up fails a dozen outbox, audit and webhook
assertions on rows already sent, and the run means something different from the same run on a
cold machine. `pnpm openapi:generate` builds `@tsh/ddl-schema` and then rewrites
`packages/shared/openapi/engine.openapi.json` from the engine's decorators (§11) with no Docker
involved, archiving the previous document first when the engine's minor version has moved; the
engine's unit suite fails while that file is stale.
cold machine. `pnpm workflow:validate` (`scripts/validate-workflows.cjs`) needs no stack at all —
it requires only that `@tsh/ddl-schema` is built, says so when it is not, and warns when that
build is older than its sources, because a stale one validates against a schema the engine no
longer runs. It restates the loader's scope-discovery rules in CommonJS to stay stack-free;
`validate-workflows-script-parity.spec.ts` beside the loader fails when the two drift apart.

**Agent-context checks**: `pnpm skills:validate` (`scripts/validate-skills.cjs`) is the only one of
the three that gates anything — it runs in CI between `lint` and `typecheck`, and on every commit
through lint-staged for staged files under `.claude/skills/` and `.claude/rules/`. It invokes no
model and takes about 50 ms across the repository's tracked files, which is what lets it sit in a
pre-commit hook. A skill is prose, so nothing type-checks it, and it decays one way: it keeps citing
a command that was renamed, a file that moved, or a reference document nobody opens. The script
treats every backticked span outside a fenced block as a claim and checks it — `pnpm ...` against the
root scripts and the workspace manifests, paths against `git ls-files` so a file that exists only on
the author's machine cannot satisfy a citation, `references/*.md` links against the filesystem, and
each rule's `paths:` globs against files that exist. Frontmatter is held to the Agent Skills
specification (agentskills.io), which every SKILL.md consumer shares: `name` must match its
directory and the spec's grammar, `description` is required and capped at 1024 characters, the
spec's optional keys (`license`, `compatibility`, `metadata`, `allowed-tools`) pass, Claude Code's
own extensions (`when_to_use`, `paths`, …) warn because every other agent ignores them — which is why
the skills carry their trigger phrases in `description` — and any other key fails, as the spec's
`skills-ref validate` fails it. A reference no document cites, a frontmatter `name` that disagrees
with its directory, two skills claiming one name, a body past the spec's 500 lines, and a rule whose
globs match nothing are failures. An unresolved path is only a warning, because a skill prescribes as much as it
describes: `creating-engine-bffs` names `packages/demo-bff/CLAUDE.md` as a file to create. `--strict`
promotes warnings to failures and CI does not pass it, so a citation that went stale when a file was
renamed is reported without failing the build.

**Measuring what a skill does**: `pnpm skills:routing` and `pnpm skills:ablation` answer the two
questions the validator cannot. Neither runs in CI, and neither can: both drive headless Claude Code
on the machine's signed-in Claude Code account through `scripts/skill-eval-runner.cjs`, which strips
every API-key, gateway, Bedrock and Vertex variable from the child's environment, and neither is
deterministic. As required checks they would attach a spend surface to every pull request.
`skills:routing` (`scripts/test-skill-routing.cjs`) measures whether a skill is reached for at all,
which is what `description` decides and what nothing else checks. It runs prompts
phrased the way a person would phrase them rather than the skill's own trigger words, and records
which skill fires; only the skills under `.claude/skills/` are scored, because a plugin skill firing
is a fact about the machine the sweep ran on rather than about this repository. `skills:ablation`
(`scripts/test-skill-ablation.cjs`) measures whether having the skill changes the output: each case
runs twice on the same prompt in two clone-on-write copies of the repository, once with the skill in
place and once with its directory deleted. Both copies keep `CLAUDE.md`, `.claude/rules/` and `docs/`,
so what is measured is the skill rather than the whole context setup. The artifact is graded rather
than the transcript, and `validate-workflows.cjs` and `compile-workflow.cjs` grade it — the same
answer the engine reaches at load. No model judges anything, which is what makes a result arguable.
Both scripts share `scripts/skill-eval-runner.cjs`: the headless `claude` invocation, the stream
reader, sandbox creation and cost accounting.

**Golden sets** (`packages/skill-evals`, `@tsh/skill-evals`; `pnpm skills:evals`;
[0023](decisions/0023-skill-golden-sets-run-claude-code-headless.md)): the third model-driven check,
and the one that answers "does a given input still produce the same or a close enough output". Each
skill keeps its cases beside it in `.claude/skills/<skill>/evals/evals.json`, after the Agent
Skills convention: a prompt in a person's words, an `expected_output` a human wrote as required
core content, deterministic `checks`, judged `assertions`, an optional `golden` reference (a
workflow document or an answer under `golden/`) and optional `files` placed into the sandbox first
(under `files/`). A run copies the repository the way the ablation does, deletes every skill's
`evals/` from the copy so the model under test cannot read the answers, commits, and runs headless
`claude` with the skill installed and MCP servers dropped. By default the prompt is sent as
`/<skill> <prompt>` (`"invocation": "explicit"`), the Agent Skills guide's own pattern for output
evals: the case measures what the skill's content produces, and whether the skill is _reached for_
is `skills:routing`'s question — the first smoke runs on `haiku` answered natural prompts without
invoking either skill, so a natural default would have measured the model without the skill.
`"invocation": "natural"` sends the prompt bare, which a case about the skill _not_ firing needs;
the harness's first message lists the skills it discovered, and an explicit invocation of a skill
it did not discover is an errored run, not a silent miss. The checks then decide what a script can
decide — which skill fired, which files changed (and how many), whether a workflow compiles and
validates through `@tsh/ddl-schema`, whether it carries the expected `id` and `version`, whether
its compiled graph (step types, ports, conditional arms, terminal outcomes, with every author-chosen
name removed) equals the golden's, whether the final answer matches a pattern — and a second,
tool-less `claude` call on the judge model scores the result 0–100 against the expected output with
a fixed rubric and grades each assertion with evidence. A run passes when every check
passes, every `error` assertion passes and the score meets the threshold (70 unless the set says
otherwise); a case passes when enough of its graded runs did (`--pass-rate`, 0.5); a run the
harness or the judge did not finish is excluded and keeps its sandbox, and a case with no graded run
fails. A set or a case may declare the agent `model` it needs; `--model` is the default for the
rest and `--override-model` runs everything on one model. The BFF set and the `fixture-consent-review`
case declare `sonnet`. The smoke
runs that shaped this (2026-09-17) showed why: on `haiku` with a bare prompt neither skill fired and
both cases failed (judge 35 and 62, the graph check finding two arms the golden lacks); with the
skill invoked explicitly, `haiku` fixed the broken workflow byte-for-byte (judge 97) but answered
the upload-conflict question against the skill's own rules (judge 48), while `sonnet` passed both
(95 and 80) at $0.54 and $0.32 a run. A full run on the defaults then passed 6 of 7 at $1.39 — the
consent fixture on `haiku` came out as a `connector-call` with an invented connector id, which the
graph check named, and passed on `sonnet` at $1.06 — so that case declares `sonnet` too. That is the
suite discriminating, not the harness failing. The
judge call costs under a cent because the harness's own system prompt is replaced and
MCP servers and skills are excluded; an agent run on the default `haiku` costs tens of cents, on
`sonnet` up to a few dollars, which `--max-budget-usd` caps. Changed files are measured
against the sandbox's baseline commit — the working tree diffed against it, plus the untracked
files — so an agent that commits its work is still graded on it. Every run records what the agent
did: the files git saw changed, every tool call with the file, command or query it was aimed at (a
path outside the sandbox marked as such), the final message, and the harness's exit code, result
subtype and stderr; a run that did not pass shows that record under its verdict, and the console
prints the failed checks and assertions under the case line as it finishes. The report is
`report.json` and `report.md` under the package's gitignored `reports/`, rewritten after every
finished case; `--print-report` prints the whole Markdown to stdout when the run ends.
A `SIGINT` or `SIGTERM` stops the agents in flight, removes their sandboxes and leaves the report
marked partial with the runs it was waiting on.

**The suite runs on a developer's machine and nowhere else**, on that machine's signed-in Claude
Code account: there is no workflow, `skills:evals` exits 2 when `CI` or `GITHUB_ACTIONS` is set,
and `localAccountEnv` (`scripts/skill-eval-runner.cjs`) deletes every credential variable that
would route a run elsewhere — a key, an auth token, a base-URL override, the Bedrock and Vertex
switches, listed in `CREDENTIAL_ENVIRONMENT_VARIABLES` there — from every `claude` child, naming on
the console whichever of them the machine had set. What asks for a run is
`scripts/skill-evals-reminder.cjs`, wired in `.claude/settings.json` as a `PostToolUse` hook on
edits under `.claude/skills/` and a `Stop` hook before a turn ends. The `Stop` hook reads
`git status --porcelain` under `.claude/skills/` — reports are gitignored and say nothing about
which state of which skill was graded — hashes the content of what changed, and blocks the stop
once per state with the command for each changed skill (`pnpm skills:evals --case <skill>`), so a
further edit earns another reminder and a rerun of the suite does not. Its state lives per session
under `$TMPDIR/tsh-skill-evals-reminder/`, outside the repository. Inside an eval sandbox both
hooks are off: `createSandbox` deletes the `hooks` key from the copied settings and `runClaude`
sets `SKILL_EVALS_SANDBOX=1`, either of which the script honours — without them the agent under
test would be reminded to evaluate the skill it is being measured on, and a `Stop` block would keep
it from finishing. `--validate` checks every golden set and
compiles every golden workflow without a model, runs in lint-staged for staged files under
`evals/`, and is also a unit test of the package, so `pnpm test` fails on a golden set the runner
would refuse. Seven cases ship: four for `creating-workflows` (a new fixture graded against a
golden graph, a new built-in revision, a users-scope document with an unwired port to fix, and a
question neither skill should fire on) and three for `creating-engine-bffs` (the double-upload
`409`, the submit timeout, the error-code mapping), each judged against a golden answer.

**What the skill checks do not cover**: the ablation cases target `creating-workflows` only —
`creating-engine-bffs` has none, and `.claude/rules/` has no behavioural test. `validate-skills.cjs`
has no spec of its own, unlike `validate-workflows.cjs`. Golden-set results describe the machine
they ran on, and every run is now on someone's own machine: the `tsh-*` plugins a developer has
enabled offer the agent skills another developer's run would not, so two verdicts on the same case
are not strictly comparable — the report names every skill that fired, which is what makes such a
difference visible. Nothing reruns a case for a second opinion; the person who changed the skill is
the one who runs it and the one who reports the verdict.

**CI** (GitHub Actions, the only CI system in the repo): Postgres and Redis as service
containers; **Garage started as a plain `docker run`** because Actions service containers cannot
override an image command and `dxflrs/garage:v2.4.1` has no entrypoint — a comment in the
workflow records this and warns against the archived Bitnami image. There is no bucket-creation
step: `garage server --single-node --default-bucket` creates it itself, and a bounded poll of
`garage bucket info orchestrator-files` waits for that boot to finish before the suites run. Then
`corepack enable → install --frozen-lockfile → cp .env.dist .env → lint → skills:validate →
typecheck → build → test:cov → install Playwright chromium → test:e2e:ci →
test:mailhog:integration`. It is the only workflow: the model-driven skill checks run on a
developer's machine on their own signed-in Claude Code account and have none (above). The last step
runs `POSTGRES_PORT=55432`: it is the only step that starts the Compose stack, whose `postgres`
container would otherwise try to publish host 5432 and collide with the job's own Postgres service
container.

**Testing**: 98 co-located engine unit spec files, 21 engine e2e spec files (real
Postgres/Redis/Garage via supertest against a booted Nest app; 20 of them run by default, with
`smtp.e2e-spec.ts` reserved for `pnpm --filter @tsh/engine test:smtp`). Each of those suites starts
its application through `test/e2e-server.ts`, which leaves it listening on one loopback port for
the file: handed a server that is not listening, supertest binds and closes an ephemeral port per
request, and a run's worth of that churn reissues ports under sockets Node still has pooled, so a
request reaches a peer that is gone and fails as a parse error unrelated to what it was testing.
`test/setup-e2e-sockets.cjs` empties the global agents' pools between files for the same reason.
There are also 21 DDL spec files, 60
admin-panel unit spec files under Vitest plus 3 Playwright specs, and one demo-web placeholder spec.
Last observed green: 1623 engine and 484 DDL unit tests, 584 admin-panel unit tests, 297 engine e2e
tests, 15 admin-panel browser tests. **Coverage is measured but the spec's 80%/95% gates are not enforced.**

**Documentation site** (`packages/docs`, `@tsh/docs`; `docs/decisions/0016-docusaurus-documentation-site.md`):
Docusaurus 3, classic preset, skinned with the TSH design system (`src/css/custom.css`, Inter Tight
and JetBrains Mono from Google Fonts as the only type, with no font file committed, an ejected footer and a custom home page; the
design spec is `packages/docs/THEME.md`). Three docs instances: **Guides** (`docs/guides`,
hand-written: introduction, getting started, your first onboarding, configuration, extending; wherever
a guide shows a step from an example workflow it shows the `custom` form and the specialized form side
by side, and its request and response samples come from a real run), **API**
(`docs/api`, generated from `packages/shared/openapi/engine.openapi.json` by
`docusaurus-plugin-openapi-docs`, grouped by the document's audience tags, plus three hand-written
overview pages; versioned with Docusaurus' docs versioning — the current document is the `current`
version at `/api` and each minor archived under `packages/shared/openapi/versions` (§11) is a
version at `/api/<major.minor>`, generated at build from its frozen document by an OpenAPI plugin
entry of its own, its sidebar written as JSON by `scripts/finish-api-pages.mjs` through the same
builder as the current one, the overview pages copied in with that version's download link, every
page of an archived version carrying Docusaurus' version banner in the project's wording
(`i18n/en/code.json`: the version described, Guides describe the current engine, link to the same
page in the current version), a `docsVersionDropdown` in the navbar switching between them, and the
navbar's API entry a `doc` item of the `api` instance so it opens the version last chosen rather
than always the current one; `scripts/prepare-api-versions.mjs`
registers the versions before any `docusaurus` command, because Docusaurus refuses to load with a
listed version whose folder is missing, and the site is plainly unversioned while no minor has been
archived) and **Fixtures** (`docs/fixtures`, written by `scripts/generate-fixtures.mjs`, which
compiles every workflow file the way the engine does: one page per file in `workflows/fixtures` and
`workflows/built-in`, at `/fixtures/<file stem>` and titled by the document's `id`, showing an
at-a-glance table, the authored steps with what each compiles to when the file uses specialized
types, the compiled step map and the file itself; a built-in page also links the revision written
in the other form, revision 1 and its `-v2`; plus a gallery with connector-type filters). Generated pages are
never committed: `start`, `build` and `typecheck` regenerate them first — clearing the previous
output before generating, because the OpenAPI plugin never overwrites a file that exists — and
`.gitignore` excludes them (the versioning files `api_versions.json`, `api_versioned_docs/` and
`api_versioned_sidebars/` included), so the spec and the workflow files remain the only sources. Search is
`@easyops-cn/docusaurus-search-local`. The package joins the root `build`, `lint` and `typecheck`
fan-out. It reaches the engine image only as a `package.json`: `--frozen-lockfile` validates the
lockfile against every workspace importer and fails on a missing one, so the file is copied, but
the install is filtered to `@tsh/engine`, `@tsh/admin-panel` and `@tsh/ddl-schema` — the site's
Docusaurus and browser toolchain, a few hundred megabytes nothing in the image builds or serves,
would otherwise be carried into the runtime stage by `COPY --from=build /app /app`. `pnpm docs:dev`
and `pnpm docs:build` build
`@tsh/ddl-schema` first, which the fixtures generator imports; the dev server and `serve` listen on
port 3030 so they never collide with the engine on 3000. Deployment is Vercel with the project root at
`packages/docs` (`vercel.json` there runs the install and build from the repository root); the site
URL comes from `DOCS_SITE_URL` or Vercel's production hostname.

**Governance**: `CLAUDE.md` carries the repository orientation, verified commands and pitfalls
(architecture, naming, KISS, Strategy-only-where-warranted, transaction discipline), with scoped
rules in `.claude/rules/` for code design, domain constants and testing, task-scoped skills in
`.claude/skills/` (`creating-workflows`, `creating-engine-bffs`), and per-workspace `CLAUDE.md`
files for the rest. Both are maintained deliberately: when the project changes in a
way they should reflect, they are updated in the same change rather than left to drift. Husky + lint-staged gate commits on ESLint
(`--max-warnings=0`), Prettier, and — for staged files under `.claude/skills/` and `.claude/rules/` —
`validate-skills.cjs`.

---

## 14. Reading order

The code that defines the system, in the order it makes sense to read it:

1. `packages/shared/ddl-schema/src/workflow-contract.ts` — the workflow types, raw and normalized.
2. `packages/engine/src/workflows/domain/workflow.ts` and `step.ts` — evaluation and step semantics.
3. `packages/engine/src/onboardings/onboardings.service.ts` — the submit and manual-review paths,
   including locking, transaction boundaries and audit placement.
4. `packages/engine/src/connectors/ports/connector-adapter.port.ts` — the single connector contract.
5. `packages/engine/src/webhook/webhook.repository.ts` — the outbox claim/finalize SQL, which is
   where the delivery guarantees actually live.

Five in-repo documents carry reasoning this file only summarizes, and are accurate as written:

- `packages/engine/docs/step-data-validation.md` — field types, `persist`, `connectorData` vs
  `acceptedData`, validation formats.
- `packages/engine/docs/connector-callback-signatures.md` — the inbound callback auth contract,
  including its stated limits and the per-reason status split.
- `packages/engine/docs/http-request-connector.md` — the generic HTTP connector's config, placeholder
  namespaces, outcome mapping and what it does not support.
- `packages/engine/docs/audit-log-contract.md` — audit reliability tiers, data boundaries and
  non-guarantees.
- `packages/shared/ddl-schema/docs/extending-field-types.md` — how the two registries work and what
  a new field type or text format must respect.

Conventions the codebase is held to live in the root and per-workspace `CLAUDE.md` files and the
scoped rules under `.claude/rules/` (code design, domain constants, testing), with the task-scoped
procedures in `.claude/skills/` (`creating-workflows`, `creating-engine-bffs`).
