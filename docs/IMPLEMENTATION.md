# Onboarding Orchestrator — What Is Actually Built

**Status:** describes `main` at `ba47f92` (2026-09-11), which made typed steps the only authored
form (§2.1, [0011](decisions/0011-typed-steps-are-the-authored-form.md)), plus the uncommitted
OpenAPI document and documentation site (§1, §5, §11, §13) in the tree; those sections were
re-verified for those changes and the rest is carried forward from the `53ff861` verification.
Bump this when that work lands.
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
| New error class                                                    | the code/status table in §11                                 |
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
POST /v1/onboardings                 → create row, status/step from workflow.initial
GET  /v1/onboardings/:id/state       → descriptor of the step the client must render now
POST /v1/onboardings/:id/submit      → validate → connectors → transition → commit  ← the only advancing call
POST /v1/onboardings/:id/review/:a   → operator-driven transition (approve|reject|invalid)
POST /v1/webhooks/:type/callback     → provider resumes a parked async connector, then submits
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
| `packages/admin-panel` (`@tsh/admin-panel`)      | **Working slice**      | React 19 + Vite operator UI: onboarding list, audit log, and a Connectors tab that writes settings. Talks to the engine directly.                                                                  |
| `packages/demo-bff`                              | **Empty placeholder**  | Name/version only. No source.                                                                                                                                                                      |
| `packages/demo-web`                              | **Skeleton**           | A Playwright config and one placeholder spec. No app.                                                                                                                                              |
| `packages/docs` (`@tsh/docs`)                    | **Substantive**        | The documentation site: Docusaurus 3 with the TSH theme; hand-written guides, an API reference generated from the OpenAPI document and a fixtures gallery generated from the workflow files (§13). |
| `packages/shared/openapi` (`@tsh/openapi`)       | **Generated artefact** | `engine.openapi.json`, the engine's OpenAPI 3.1 document, written by `pnpm openapi:generate` and held equal to the code by a unit test (§11). No source of its own.                                |
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
  "name": "Base",
  "initial": "collect_email", // optional; defaults to the first step
  "webhook": { "notify": { "path": "notify" } }, // optional outbound notification target
  "scoring": { "risk": { "min": 0, "max": 100 } }, // optional named scores, integer bounds, min < max
  "steps": [
    {
      "name": "collect_email",
      "status": "awaiting_user", // the onboarding status while this step is active
      "data": {
        "email": { "type": "text", "required": true, "validation": { "format": "email" } },
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

_Reasoning:_ before this, `twilio_verify` returning `CHALLENGE_EXPIRED` for an SMS that arrived
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

`CONNECTOR_TYPES` = `kyc | kyb | aml | credit | phone_verification | email_verification |
email_delivery | sms_delivery | bank_verification | payment | e_signature | document_storage |
custom`.

A step's connector declaration names two things. `id` is the adapter it invokes — `twilio_verify`,
`smtp` — matched against `ConnectorAdapter.id`. `type` is what that adapter **does**, from the set
above, so `sendgrid_email` and `smtp` are both `email_delivery` and adding a provider joins an
existing value rather than adding one.

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
  "name": "Example",
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
`k`. The semantic invariants below carry a reason and no path, for either phase.

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
| `kyc-identity-verification` | verify    | One parked step, seven ports, connector declaration derived from the contract                                    |
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
`otp-verify` accepts `phone_verification` or `email_verification` and assumes the one that follows
from its `channel`; `kyc-identity-verification` accepts `kyc`; `notify` accepts `email_delivery` or
`sms_delivery`; `http-call` accepts `custom` and defaults to `http_request`. The slot's `extras`
says what else the binding may carry: `otp-verify` lets the author add `fieldMapping` keys beside
the `recipient` and `code` it derives, and `kyc-identity-verification` and `notify` let them add
both `fieldMapping` and `config` keys beside what the type derives (for `notify` that is only the
`recipient` key, so the template's payload keys and the adapter's settings all travel on the
binding). An addition that would override a derived key is refused — the derivation is the point of
the type — and `GET /v1/admin/step-types` publishes each type's `connectorTypes` so a builder can
filter the configured connectors before the author picks one.

Every binding also carries the compiled form's **failure policy** (§4): `errorHandler`, `retry` and
a `fallback` chain of up to three entries, each naming an `id` of the same capability and, where
the slot allows, its own `fieldMapping` and `config` additions — laid under the same derived keys
the primary has, so an SMTP stand-in can name the template an email API's primary never needed,
while an entry declaring no additions inherits the primary's. `otp-verify`'s entries carry their
own `startConfig` and `checkConfig`, since a mock's `challenge` is Twilio's `startVerification`.
The `connector-call` type has no slot at all: its `connectors` are declarations in full, as a
compiled step carries them, which is what makes a mock `kyc` adapter on a collection step
expressible without a `custom` step.

**Collecting contact details and proving them are two steps.** `contact-details` collects `email`
and `phoneNumber` under those canonical names, each `required`, `optional` or `omitted`.
`otp-verify` collects nothing: it sends to the field the canonical role of its channel resolves to
(`phoneNumber` for `sms` and `voice`, `email` for `email`), which a collector earlier in the
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
rules below — **before** upserting anything into the `workflows` table keyed by
`(workflow_id, version)`, and applies the same checks again to every stored revision it reads back.
Validating ahead of the upsert is what keeps a rejected document out of the table: an engine-level
mistake such as an `errorHandler` naming a handler that is not registered would otherwise be
persisted by the very startup it then fails, and every later startup would fail on the stored row
even after the file was fixed. Anything wrong — unreadable directory, malformed workflow, unknown
transition target, duplicate step name, two files sharing an `id` **and** `version`, unresolvable
`{{secrets.*}}` reference, invalid `http_request` config — throws during startup. A repeated `id`
at a _different_ version is legal: that is how a revision is published.

**The table, not the file set, is the read model.** `getById` is async and queries `workflows` on
every call, then validates, normalizes and builds a fresh `Workflow`; nothing is cached between
requests. A revision edited, drafted or retired directly in the database — by the admin UI, say —
takes effect on the next request rather than the next deploy, and every engine instance answers
identically. Files only seed: the upsert sets `status` on insert alone, so a revision moved off
`published` in the database is not republished by the next startup.

Failures are reported as `WorkflowInvalidError` with one of nine fixed reasons (`INVALID_SHAPE`,
`UNKNOWN_PROPERTY`, `INVALID_VALUE`, `DUPLICATE_STEP_NAME`, `DUPLICATE_FIELD_NAME`,
`DUPLICATE_TRANSITION`, `INVALID_TRANSITIONS`, `UNKNOWN_TARGET`, `INVALID_TERMINAL_STEP`). That
list is treated as a public contract; new field types fail with `INVALID_VALUE` rather than adding
reasons.

One further startup invariant crosses document boundaries and sits outside that per-document list:
`WorkflowRegistryService.onModuleInit` also sweeps every stored workflow for a repeated connector
`config.sourceKey`, throwing `DuplicateWorkflowSourceKeyError` when two different workflow
documents declare the same value — the same key repeated within one document, across steps or
connectors, is legal and does not trigger it. It is generic over connector id, no adapter is
special-cased, and it exists because `sourceKey` is how an operator names one workflow's
deployment-specific connector configuration (`sumsub_kyc`'s, for one — §4) for correlation outside
the engine; two documents silently sharing one would make that correlation ambiguous.

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

**Webhooks**

- The root `notify.path` is validated segment by segment against `[A-Za-z0-9._~-]+`, rejecting
  empty segments, `.` and `..` — so a declared path cannot traverse out of the configured base URL.
- A transition `webhook` may only carry `notify: false`. It has no destination of its own.

### Revision status

Every stored revision carries its own `status`, so one workflow id can hold a published revision
serving traffic, a newer draft, and older discontinued ones at the same time.

| Status      | Unpinned start        | Pinned lookup (an in-flight onboarding) |
| ----------- | --------------------- | --------------------------------------- |
| `published` | Highest one is served | Served                                  |
| `draft`     | Skipped               | Served, so a draft can be tried out     |
| `retired`   | Skipped               | Refused with `WORKFLOW_RETIRED` (410)   |

`draft` means "not usable yet"; `retired` means "not usable any more". Retiring is therefore a hard
stop, not a soft one — onboardings already pinned to a retired revision cannot read their state or
submit either, which is the point of the status and the thing to weigh before setting it.

**Known limitation:** there is no write API for the table. Revisions reach it by being committed as
files under `workflows/`, and status changes are made directly in the database; `POST /v1/workflows`
and a status-transition endpoint are unbuilt.

### Checked-in workflows (`workflows/`)

#### `built-in/` — shipped, loaded in every environment

| File                                         | Rev | Authored as                           | Connector types                       | Is                                                                                           |
| -------------------------------------------- | --- | ------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `eu-b2c-individual-kyc-eea.workflow.json`    | 1   | `custom` steps, one per compiled step | `phone_verification`, `kyc`, `custom` | The reference EU B2C individual KYC flow; the applicant chooses passport or national ID card |
| `eu-b2c-individual-kyc-eea-v2.workflow.json` | 2   | specialized step types                | `phone_verification`, `kyc`, `custom` | The identical flow, authored through the specialized step types (§2.1)                       |

Seventeen steps: contact and consents → SMS one-time code (with a resend path) → declared identity →
purpose and source of funds → `select_document_type` → the capture steps for the document chosen →
selfie → `submit_kyc` → manual review → account provisioning → `userId` collection → `approved` /
`rejected` / `invalid`.

**Two revisions, one flow.** Revision 1 is the flow written step by step — seventeen `custom`
steps, each carrying one compiled step verbatim, which is what a document written as untyped steps
converts to. Revision 2 is the same onboarding written as fifteen specialized steps, with one
deliberate difference: collecting the contact details and proving the phone number are separate
steps, so the one-time code is sent by a compiled step of its own, `send_phone_code`, rather than
by the submit that collected the number. Eighteen compiled steps against seventeen, and
`packages/engine/src/workflows/eu-b2c-revision-equivalence.spec.ts` pins exactly that: the
contact step collects the same fields and consents, the send step carries the connector the contact
step used to, and every other step normalizes to the identical definition — the same fields, the
same connector declarations, the same transitions. 957 lines against 271. Every invariant in
`eu-b2c-individual-kyc-workflow.spec.ts` runs against both, so the specialized types are held to the
step-by-step document's own rules rather than to a weaker set written for them.

They share `config.sourceKey`. The engine enforces uniqueness of a source key per **workflow id**
rather than per revision (`WorkflowRegistryService.assertUniqueSourceKeys`), which is the rule
saying the key belongs to the product: two revisions of one onboarding must not split its traffic
at the provider. Starting an onboarding without naming a version therefore picks revision 2, and an
onboarding already in flight stays on the revision it was created with.

**One document, both routes.** A workflow definition may contain at most **one Sumsub-parked
step**: the adapter's callback submits the closed, un-suffixed key set `kycOutcome` /
`kycRetryStep` / `kycReasonCodes` / `kycCustomerMessage`, the engine re-submits it through the step
that parked, a key the step does not declare is an `UNKNOWN` field error that loses the verdict, and
field names are unique across a whole definition. Branching to several `sumsub_kyc` steps is
therefore not available, and everything that varies per applicant — issuing country and document
type alike — has to vary _within_ one declaration.

`config.documents[].countryField` is what allows that. A document mapping may name a connector
payload key holding the applicant's own ISO alpha-2 issuing country instead of fixing an alpha-3 in
config — exactly one of `country` / `countryField`, enforced by `parseSumsubConfig`. The adapter
converts it through the same ISO table `buildFixedInfo` uses, which carries all 249 assigned codes.
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

Adding a jurisdiction means extending `nationality`, residence `country` and whichever issuing-country
enums the state belongs in — plus the Sumsub level, which is per declaration. Adding a document type
means a `documents[]` entry, its capture steps and a routing arm on `select_document_type`.

Four further details are consequences of engine behaviour rather than of the business flow:

- **All four callback fields are declared**, not just `kycOutcome` and `kycRetryStep`.
  `buildReasonFields` attaches `kycReasonCodes` and `kycCustomerMessage` to every `retry` and
  `refused` verdict, so a document that omits them loses exactly the verdicts that carry a reason.
- **Each retry arm returns to a step the reset data can be re-collected from** — `IDENTITY` to
  `select_document_type`, so a customer whose document was refused may also switch to the other one;
  `SELFIE` to `capture_selfie`; `QUESTIONNAIRE` to `collect_purpose` (the questionnaire is
  re-submitted on every execute, so that one converges). `APPLICANT_DATA` is the exception and goes
  to **manual review**: `createApplicant` returns the _existing_ applicant on a repeat
  `externalUserId` and the adapter has no way to update `fixedInfo`, so re-collecting personal data
  could never reach Sumsub — routing it back to `collect_personal` would ask the customer to retype
  into a void. Each arm pairs `kycRetryStep` with `kycOutcome` inside an `all` block, because
  persisted context keys are never deleted and a `kycRetryStep` from an earlier pass survives.
- **No callback field caps a length the provider controls.** `kycCustomerMessage` carries Sumsub's
  `moderationComment`, which is operator-authored free text with no length guarantee; a `maxLength`
  on it fails the parked step's own validator and loses the verdict outright.
- **`manual_review` declares a recursive `success` transition.** `canSubmit: false` is advisory;
  the submit endpoint guards only on approved/completed, so without a `success` arm a stray empty
  POST resolves to no transition and lands the onboarding in terminal `invalid`.

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

#### `fixtures/` — examples, skipped when `NODE_ENV=production`

Each example exists to exercise one mechanism end-to-end, and ships **twice**: `<name>.workflow.json`
(id `<name>`) is written as `custom` steps, one per compiled step, which is the shape any untyped
document converts to; `<name>-typed.workflow.json` (id `<name>-typed`) is the same example through
the specialized step types and uses no `custom` step. The e2e suites address the plain ids, whose
compiled steps are unchanged. `packages/engine/src/workflows/checked-in-workflows.spec.ts` guards the
pairing, runs the adapters' load-time config checks over every checked-in file, and pins the seven
pairs that compile to identical steps; the "Typed twin" column says how the other four differ.

| File | Connector types | Demonstrates | Typed twin |
| ------------------------------------ | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- -------------------- |
| `base` | `kyc` | Multi-step chain, two connectors on one step, root notify webhook, per-transition suppression | Identical: two `connector-call` steps, the first including `contact-details`, its `success` arm carrying `webhook: { notify: false }` |
| `conditional-fields-and-transitions` | `kyc` | `when` on fields and on transitions, `persist: false`, branching manual review | `form`, a `connector-call` with conditional arms, two `manual-review` steps with a conditional `approve` arm and no `invalid` port; differs only by the stray-submit `success` arm every `manual-review` emits |
| `twilio-verify` | `phone_verification` | The same shape against a real provider | One `otp-verify` including `contact-details`, so the send step still collects the number; adds the `request_code_resend` step and the stale-challenge arm |
| `sendgrid-email` | `email_delivery` | Dotted `fieldMapping` targets (`dynamicTemplateData.first_name`) | Identical: `notify` including a `form`, the template keys on the binding's `fieldMapping` |
| `manual-smtp` | `email_delivery` | Local MailHog send with an HTML template from connector config | Identical: `notify` including a `form`, `templatePath` on the binding's `config` |
| `file-upload` | `kyc` | `file` field plus the document reservation flow | Identical: a `connector-call` carrying the `file` field |
| `http-request` | `custom` | The generic HTTP connector with placeholders, query, and error statuses | Identical: `http-call` including a `form`, `fieldMapping` naming the two payload keys that differ from their fields |
| `sumsub-kyc` | `kyc` | The first `async: true` declaration; four `kycOutcome` values routed to four distinct targets by the workflow, not the adapter | A two-sided `document-capture` including `identity-profile`, `address` and `questionnaire`, then `selfie-capture` and `kyc-identity-verification`; the issuing country comes from residence rather than a fixed `POL`, and the field validations are the steps' |
| `manual-review` | none | All three manual triggers and a recursive `success` transition | Identical: `manual-review` including a `form` |
| `connector-fallback` | `email_delivery` | An unconfigured `sendgrid_email` primary retries three times 200 ms apart, falls through a `mock_email_delivery` link told to fail, and is delivered by `smtp` on `send_notification`; `optional_notice` swallows the same failure via `errorHandler: continue_on_error` with no fallback declared | Identical: the whole chain, retry and handler on the `notify` binding, the SMTP entry with its own `fieldMapping` and `config` |
| `scoring` | `phone_verification`, `kyc`, `email_delivery` | Two root scores (`risk` 0-100, higher worse; `trust` 0-50, higher better) across an 11-step individual KYC flow; `collect_profile` scores both from applicant data and gates straight to `manual_review` or falls through to `request_code`; the sync `twilio_verify` step (`verify_code`) carries a `trust` rule gated on `pepSelfDeclared` being `false`, so a proven phone raises identity confidence but a self-declared PEP cannot offset their exposure with it, and the async `sumsub_kyc` step (`submit_kyc`) also carries scoring rules, with `submit_kyc`'s `retry` outcomes looping back to `capture_identity` / `capture_selfie` and accumulating `risk` across attempts until a later `verified` pass can still land on `manual_review`; `manual_review` declares a score-gated `manual.invalid` arm (`risk <= 45`) ahead of its unconditional `manual.invalid` fallback, so an operator can send a borderline case back to `request_code` for another phone verification instead of only approving or rejecting | Twelve compiled steps through specialized step types: step-level `scoring` on `identity-profile`, on `otp-verify` (landing on `verify_code`) and on `kyc-identity-verification`; the risk band routes through conditional edges on `success` and `verified`; `manual-review`'s `invalid` edge is score-gated with a fallback arm |

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
5. `workflow.evaluate(...)`:
   - `Step.collectAcceptedData` — unknown fields, inactive-but-submitted fields, missing required
     fields, and per-field schema failures all produce `{field: ['UNKNOWN' | 'REQUIRED' |
'INVALID']}`. Any error → `400 INVALID_STEP_DATA` with the error map; the state is unchanged
     and the client retries.
   - Connector chain runs (§4) against `connectorData` merged over context.
   - Outcome maps to a trigger: accepted → `success`, rejected → `rejected`, pending → park,
     invalid-data → either retryable (back to the client) or terminal-invalid.
   - Scores recalculate here, immediately before target resolution: `Scoring.applyRules` sums the
     current step's `scoring` rules onto the onboarding's scores and clamps once (§2). This sits
     after the connector chain, not before it, so it runs exactly once per resolved transition — a
     pending outcome returns above this point without scoring, and its callback resume re-runs
     `evaluate` and scores once when the chain finally resolves.
   - `Step.resolveTransition(trigger, transitionContext, rejectionReason)` picks the **first**
     transition whose status matches, whose `reason` covers the refusal, and whose `when` holds.
     Order in the JSON is the precedence. Since the unconditional fallback is optional (§2), a
     trigger whose arms all fail resolves to no transition, which ends the onboarding `invalid`.
6. Assign the next state, save, and write the `onboarding.state_transition` audit row **inside the
   same transaction**.
7. Commit, then notify the client webhook (§6) outside the transaction.

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
  "name": "twilio_verify", // instance name, unique within the step
  "id": "twilio_verify", // resolves to a registered adapter's `id`
  "type": "phone_verification", // what that adapter does; must match the adapter's own `type`
  "order": 1, // execution order within the step
  "async": false, // true → initiate, park, resume on callback
  "canReject": true, // this call may reject; constrains the step's `rejected` routing
  "fieldMapping": { "recipient": "phoneNumber" }, // payloadKey → context/field name
  "config": { "operation": "startVerification" },
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
`name`, `id`, `type`, optional `supportsAsyncCallback` + `callbackAuth`, optional
`validateDeclaration`, required `execute`, optional `mapCallbackResult`.

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
`pending({connectorName, connectorId, connectorOrder})` and the remaining connectors are
**not** run.

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
every link of its chain (`resolvers/awaiting-callback-connector.resolver.ts`).

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
other rule; only `twilio_verify.verifyServiceSid` and `sendgrid_email.from` declare one today. An
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

| Id               | Keys                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- |
| `sendgrid_email` | `apiKey` (secret, required), `from` (required, must match an email-address `pattern`)                                 |
| `twilio_verify`  | `accountSid` (required), `authToken` (secret, required), `verifyServiceSid` (required, must match `^VA[A-Za-z0-9]+$`) |
| `smtp`           | `username`, `password` (secret) — neither required alone, but one without the other is rejected                       |
| `sumsub_kyc`     | `appToken` (required), `secretKey` (secret, required), `callbackSigningSecret` (secret, required)                     |

Stored values are one flat `Record<string, string>` per connector, held as plaintext JSON in the
`connectors` table (`id` primary key, `type`, `settings jsonb`, `updated_at`, `updated_by`) — see
§9. **Confidentiality at rest is the database's responsibility, not the
engine's**: there is no crypto module and no encryption key, and a dump, a replica or any `psql`
session exposes every connector credential in clear (see §10 and the decision record). There is
no cache: every execution re-reads the row, so a credential submitted over the admin API takes
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
`id` is the adapter's own identifier (`twilio_verify`), `type` is its capability from
`CONNECTOR_TYPES` (§2), so `sendgrid_email` and `smtp` are both `email_delivery`. `type` is declared
by the adapter, never submitted by an operator — a capability is not a configuration choice, and the
list endpoint has to report one for connectors that have no stored row at all. It is stamped onto
the row on every settings write, so a stored row still describes itself when read straight from the
database.

A response's `settings` entries carry `key`, `secret`, `required`, `source` (`stored`/`unset`)
and `value` — `value` is present only when `secret` is `false`; a secret's value never leaves the
engine, not even masked. `PUT`'s body is `{ settings: Record<string, string> }` and rejects with
`400 CONNECTOR_SETTINGS_INVALID` on an undeclared key, a missing
required key, a non-string/empty value, a value that fails a field's declared `pattern` (for
example `twilio_verify.verifyServiceSid` and `sendgrid_email.from`), or — because `PUT` replaces
the map wholesale — a body that silently omits a key that is currently stored. That last case
names every key that would be dropped and is refused unless the request carries `?replace=true`,
the explicit opt-in to drop them. `smtp` additionally rejects `username` or `password` supplied
alone: an unauthenticated SMTP session is a real configuration, but only when neither key is
sent. Every issue is collected and reported at once, naming every offending key. A `connectorId`
naming an unregistered adapter, or one with no `settingsSchema`, answers
`404 CONNECTOR_NOT_FOUND`.

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

| Type                                                 | Kind        | Notes                                                                                                                                   |
| ---------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `http_request`                                       | **Generic** | Config-driven outbound JSON call. Env-configured secrets; see `packages/engine/docs/http-request-connector.md`.                         |
| `twilio_verify`                                      | Real        | Twilio Verify start/check; `TwilioVerifyUnavailableException` on provider failure.                                                      |
| `sendgrid_email`                                     | Real        | Dynamic-template send; dotted `fieldMapping` keys build nested payloads.                                                                |
| `smtp`                                               | Local       | Nodemailer to MailHog; HTML template from `config.templatePath`. Plaintext SMTP is only permitted when the host is literally `mailhog`. |
| `sumsub_kyc`                                         | Real        | KYC via Sumsub; `async: true`-only (park on `execute`, resume on the provider's callback). See "The KYC connector" below.               |
| `mock_kyc_1`, `mock_kyc_2`                           | Mock        | Always accept, after a five-second delay. Two exist so `base` can show ordered connectors in one step.                                  |
| `mock_phone_verification`, `mock_email_verification` | Mock        | In-memory OTP challenge with TTL and attempt budget; rejects with `ATTEMPTS_EXHAUSTED` / `CHALLENGE_EXPIRED` / `CHALLENGE_NOT_FOUND`.   |
| `mock_email_delivery`                                | Mock        | Keeps the templated message in memory instead of sending it.                                                                            |
| `mock_sumsub_file_upload`                            | Mock        | Reads a completed document from object storage.                                                                                         |
| `mock_async_callback`                                | Mock        | The async/callback reference implementation; declares `callbackAuth: {kind: 'none'}` with a justification.                              |

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

### The KYC connector (`sumsub_kyc`)

`connectors/adapters/built-in/sumsub-kyc.connector.ts` plus a `sumsub-kyc/` directory (contract
constants, config parsing, the signing HTTP client, applicant/questionnaire mapping, the outcome
table) — the same split `http_request` already established, and today's richest adapter: async,
a secret-bearing `settingsSchema`, a per-declaration `config` it parses itself, a document
resolver, and `mapCallbackResult`.

**Every outcome the callback reports is `accepted()`; the workflow document does all routing.**
`ConnectorRejectionReason` has four members (`ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`,
`CHALLENGE_NOT_FOUND`, `CONNECTOR_REJECTED`), none meaning "identity refused", and
`WorkflowTransitionStatus` is only `success | rejected | manual.*` — so rather than bend the
adapter into that vocabulary, it reports a domain outcome inside `submittedData` —
`kycOutcome: 'verified' | 'human_review' | 'retry' | 'refused'` — and the workflow document routes
on it with `when` conditions (`workflows/fixtures/sumsub-kyc.workflow.json`, §2). The adapter never
returns `rejected()` and does not declare `canReject`. An unrecognised provider state (a RED
verdict the ordered outcome table cannot explain, or a `reviewAnswer` that is neither `RED` nor
`GREEN`) throws `SumsubOutcomeUnrecognisedStateError` rather than defaulting to an outcome — Nest's
default handling turns that into `500`, and Sumsub redelivers. See
[0005](./decisions/0005-kyc-connector-outcome-contract.md).

`execute()` checks the configured Sumsub level against `config` before any side-effecting call —
`SumsubLevelNotFoundError` if the level is absent, `SumsubLevelDocSetMismatchError` if a docSet
named in `config.documents` is not on the level (the reverse is legal — a level carries steps the
adapter uploads nothing into, `APPLICANT_DATA` and `QUESTIONNAIRE`), and
`SumsubLevelQuestionnaireMissingError` if the level declares no `QUESTIONNAIRE` docSet while the
config declares a questionnaire. Each names both sides.
The check is **not cached**: it runs on every execution, so a level changed at Sumsub after the
first fetch is never missed. It then creates the applicant, uploads each configured document read
back through `CompletedOnboardingDocumentResolver` and `ObjectStoragePort` (the same path
`mock_sumsub_file_upload` already exercises), submits the questionnaire, and returns `accepted()`
— the async park itself is the executor's own `pending()`, built only because the workflow step
declares `async: true` ("Execution and chaining", above), not by anything the adapter returns.
Every Sumsub API call — in `execute()` and in `mapCallbackResult()` alike — surfaces a network
failure, a timeout or a non-2xx it cannot otherwise explain as `500 SUMSUB_UNAVAILABLE` (§11); the
one named exception is `finalizeSubmission`'s `409` for missing docSets, which carries their names
back as `SumsubSubmissionIncompleteError` instead of the generic unavailable error.

`mapCallbackResult()` resolves the onboarding still awaiting this callback through
`AwaitingCallbackConnectorResolver.findConnector({onboardingId, connectorId})`: it loads the
onboarding, resolves its workflow, finds the current step, and returns the matching connector's
`order`, or `undefined` when the onboarding is gone, terminal, or has moved past this step. A
redelivered callback that resolves to `undefined` throws `ConnectorCallbackAlreadyAppliedError`,
which the webhook route answers with an ordinary `204` instead of retrying forever (§5). A
resolved callback is then checked against `connector_applicant_references` (§9): a callback whose
`applicantId` disagrees with the row stored for that onboarding is refused rather than applied, so
a mis-correlated delivery cannot land on the wrong customer.

`submittedData` is a closed, declared shape and nothing else — `OnboardingsService.submit` writes
it verbatim into `webhook.inbound_callback_applied` audit metadata (§3, §8):

```ts
type SumsubCallbackSubmission = {
  kycOutcome: 'verified' | 'human_review' | 'retry' | 'refused';
  kycRetryStep?: 'IDENTITY' | 'SELFIE' | 'APPLICANT_DATA' | 'QUESTIONNAIRE'; // only on retry
  kycReasonCodes?: readonly string[]; // Sumsub buttonIds — machine-readable, not identity data
  kycCustomerMessage?: string; // moderationComment only, never clientComment
};
```

Never present: `clientComment`, MRZ, document numbers, dates of birth, image bytes, or a raw
provider payload.

All three credentials sit in one place. `appToken` and `secretKey` sign every outbound Sumsub
call; `callbackSigningSecret` verifies every inbound one (§5). All are operator-configured through
`/v1/admin/connectors/sumsub_kyc` like any other `settingsSchema` field (above), so the
`connectors` table is the only source for both directions and `configured` on the admin surface
means the connector can both call Sumsub and verify what Sumsub sends back. The signing secret was
env-only until
[0006](./decisions/0006-callback-signing-secret-in-connector-settings.md) moved it, after a
deployment reported `configured: true` while rejecting every callback for a missing secret.

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
5. `OnboardingsService.submit(onboardingId, submittedData, { providerIdentity, resolvedConnector })`
   replays the normal submit path with `resume`.

Responsibility is split: **the adapter declares the recipe** (header names, `sha256`/`sha512`,
`hex`/`base64`, optional epoch-seconds timestamp header with a tolerance window, optional
`parseSignatureHeader` for rotation-style packed headers, optional `buildSignedMessage`); **the
engine executes the check** — secret lookup, timing-safe comparison with no early exit across
rotation secrets, replay bounding, and failure classification.

Secrets come from the adapter's own `callbackSigningSecret` setting, resolved through
`ConnectorSettingsService` on every callback like any other connector credential (§4,
[0006](./decisions/0006-callback-signing-secret-in-connector-settings.md)). A provider-side
rotation window is a comma-separated list in that one value, and every entry is tried; a secret
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

A callback whose resolved connector no longer matches an onboarding still awaiting it — typically
because an earlier delivery already applied its verdict — is not treated as an error either: an
adapter's `mapCallbackResult` throws `ConnectorCallbackAlreadyAppliedError` (`sumsub_kyc` does,
through `AwaitingCallbackConnectorResolver` — §4), `WebhookController` catches it, records
`webhook.inbound_callback_rejected` with reason `callback_already_applied`, and answers the route's
ordinary `204` rather than the `400 INVALID_STEP_DATA` a stale redelivery produced before. That is
also the redelivery guard: a provider's retried delivery of an already-applied verdict is
acknowledged once, not reapplied.

**Documented limits** (verbatim from the connector-callback doc, still true): the callback URL is
guessable so the signature is the only barrier; secrets are keyed by connector _id_, which is right
for a dedicated adapter like `sumsub_kyc` but wrong for a generic connector and blocks
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

One event type exists: `onboarding.state_changed`, payload `version: 1`, carrying event id/type/
timestamp and `{id, workflowId, workflowVersion, status, currentStep, completedAt}`.

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
(AWS SDK v3, path-style for MinIO). `STORAGE_DRIVER` is an enum with a single value `s3` — the seam
exists, alternatives do not.

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

---

## 9. Persistence

Postgres via TypeORM, `synchronize: false`, migrations run at boot (unless `worker-only`). UUIDv7
primary keys everywhere (`generateUuidV7`) so ids sort chronologically and index locality is good.

| Table                            | Purpose                                                                                                                                                  |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboardings`                    | id, workflow id/version, status, current_step, `context` jsonb, `scores` jsonb, expires_at, completed_at, rejection_reason, timestamps                   |
| `onboarding_documents`           | reservation lifecycle: staging/final keys, requested vs verified content type/size/etag, expiry                                                          |
| `client_webhook_outbox`          | delivery state, payload, endpoint, retry policy, lease                                                                                                   |
| `audit_log`                      | occurred_at, actor, action, resource, before/after jsonb, metadata jsonb, unused hash columns                                                            |
| `connectors`                     | `id` primary key, `type` (the class it belongs to), `settings jsonb` (plaintext — confidentiality at rest is the database's), `updated_at`, `updated_by` |
| `workflows`                      | `(workflow_id, version)` primary key, `scope`, `status`, `definition` json, `type` generated from it, timestamps                                         |
| `connector_applicant_references` | one opaque provider-assigned applicant id per `(onboarding_id, connector_id)` — composite PK, unique on `(connector_id, applicant_id)`; no identity data |
| `_engine_alive`                  | trivial table from `0001_init` proving migrations run                                                                                                    |

Twenty migrations, `000N_description.ts` with a PascalCase class and a `name` ending in a 13-digit
timestamp (TypeORM parses the last 13 characters). A file under the migrations glob may export
nothing but its class: TypeORM instantiates every export as a migration. Notable ones: `0004`/`0009` widen the status
check constraint (each verifies no offending rows before narrowing on `down`), `0005` widens size
columns to `BIGINT`, `0011` adds the outbox retry policy, `0012` **drops** the outbox →
onboardings foreign key — the outbox is an independent delivery ledger and must not be deleted by
an onboarding's lifecycle, `0016` creates `connector_settings` with a check constraint that
`connector_type` matches `^[a-z0-9_]+$`, the same shape the callback route already enforces,
`0017` renames `connector_settings` to `connectors` (`connector_type` becomes `id`) and adds its
`type` column, `0018` creates `connector_applicant_references` — the composite primary key
makes the write idempotent across a re-run (a create-`409` re-derives and upserts the same row),
and the unique index on `(connector_id, applicant_id)` is what makes a provider's applicant id
resolve back to exactly one onboarding — `0019` adds `onboardings.scores jsonb NOT NULL DEFAULT
'{}'::jsonb`, and `0020` rewrites every stored `workflows.definition` still written as untyped steps
into the `custom` steps it converts to — in JavaScript rather than SQL, because a `jsonb` round trip
would reorder the keys a client renders fields in — and leaves a row already written as typed steps
alone; its `down` restores a document made only of `custom` steps and leaves any other. The project is greenfield with no deployed data, so no
other backfill runs.

`onboarding_documents.requested_max_size_bytes` / `verified_size_bytes` use a transformer that
throws on values outside the JS safe-integer range, rather than silently returning a lossy number
from `BIGINT`.

Contexts are stored as plain JSONB. **There is no field-level encryption at rest.**

---

## 10. Configuration

One `AppConfig` class (`config/app.config.ts`), validated by `validateConfig` at bootstrap via
`ConfigModule.forRoot({ validate })`. Nothing reads `process.env` directly in feature code.
`.env.dist` is the documented sample; `ConfigModule` reads `.env` (with `.env.dist` last on the
search path).

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

Timeouts are bounded rather than free-form (`CLIENT_WEBHOOK_TIMEOUT_MS`, `HTTP_CONNECTOR_TIMEOUT_MS`,
`TWILIO_VERIFY_TIMEOUT_MS`, `SMTP_TIMEOUT_MS`, `SUMSUB_TIMEOUT_MS`: 100–30000).
`SUMSUB_BASE_URL` (default `https://api.sumsub.com`) and `SUMSUB_TIMEOUT_MS` are deployment
settings on `AppConfig`, not credentials — `sumsub_kyc`'s `appToken`/`secretKey` are DB-backed
like every other adapter's `settingsSchema` (§4).

**No connector credential is declared in `AppConfig` any more.** `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SENDGRID_API_KEY`, `SENDGRID_FROM`,
`SMTP_USERNAME` and `SMTP_PASSWORD` are all deleted outright. `HTTP_CONNECTOR_SECRETS` stays,
because `http_request` is not an operator-configurable connector (§4). There is
also no engine-side encryption key to declare: the engine performs no encryption of its own (§4,
§9). The engine boots with no connector credential configured anywhere; a
workflow that reaches a connector whose required credential has no `connectors` row gets
`503 CONNECTOR_NOT_CONFIGURED` at execution time. Every real connector must be configured through
`/v1/admin/connectors` before it can run — nothing is read from `.env` on its behalf.

Host-side Compose ports are all overridable (`POSTGRES_PORT`, `REDIS_PORT`, `STORAGE_S3_PORT`,
`MINIO_CONSOLE_PORT`, `ENGINE_PORT`, `MAILHOG_HTTP_PORT`) while in-network addresses stay fixed;
the README documents each override and its blast radius. The admin panel has no port of its own —
`ENGINE_PORT` publishes both halves (§13).

`AppConfig` also carries the admin panel's own settings — `ADMIN_PANEL_DIST_DIR` and the seven
`VITE_*` keys — because the panel is served by the engine. The engine never acts on the `VITE_*`
values; it renders them into the panel's `/config.js` (§12).

---

## 11. HTTP surface and error contract

| Method | Path                                                                                                                                                                                 |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/v1/health/live`                                                                                                                                                                    |
| POST   | `/v1/onboardings` — body `{ workflowId }`                                                                                                                                            |
| GET    | `/v1/onboardings` — filters `status`, `workflowId`, `workflowVersion`, `currentStep`, `onboardingId`                                                                                 |
| GET    | `/v1/onboardings/:id` — the admin record for one onboarding                                                                                                                          |
| GET    | `/v1/onboardings/:id/transitions` — the states it moved through, oldest first                                                                                                        |
| GET    | `/v1/onboardings/:id/state`                                                                                                                                                          |
| POST   | `/v1/onboardings/:id/submit`                                                                                                                                                         |
| POST   | `/v1/onboardings/:id/review/:action`                                                                                                                                                 |
| POST   | `/v1/onboardings/:id/documents`                                                                                                                                                      |
| POST   | `/v1/onboardings/:id/documents/:documentId/complete`                                                                                                                                 |
| GET    | `/v1/admin/audit`                                                                                                                                                                    |
| GET    | `/v1/admin/workflows/:workflowId` — optional `version` pins the revision                                                                                                             |
| POST   | `/v1/admin/workflows/compile` — an authored workflow; a dry run of every startup check, storing nothing; `200 { definition, steps, workflow }`                                       |
| GET    | `/v1/admin/step-types` — the step-type palette: type, category, `composable`, `configSchema`                                                                                         |
| GET    | `/v1/admin/step-types/schema` — the workflow JSON Schema as the engine applies it                                                                                                    |
| GET    | `/v1/admin/connectors` — every configurable connector's settings state                                                                                                               |
| GET    | `/v1/admin/connectors/:connectorId`                                                                                                                                                  |
| PUT    | `/v1/admin/connectors/:connectorId` — body `{ settings: Record<string, string> }`, replaces wholesale; `?replace=true` opts into dropping a currently stored key that the body omits |
| PATCH  | `/v1/admin/connectors/:connectorId` — body `{ settings: Record<string, string \| null> }`, merges the submitted keys; `null` deletes one                                             |
| DELETE | `/v1/admin/connectors/:connectorId`                                                                                                                                                  |
| POST   | `/v1/webhooks/:providerKey/callback`                                                                                                                                                 |
| GET    | `/v1/openapi.json` — the OpenAPI document (below); served by the HTTP adapter rather than a controller, so it is not itself an operation in the document                             |

A global `ValidationPipe({ whitelist: true, transform: true })` is registered. Two routes are the
deliberate exceptions: `DynamicSubmitBodyPipe` on submit and `RawWorkflowDocumentPipe` on compile
pass the body through untouched, because whitelist stripping would delete workflow-configured field
names — or a document's own properties — before the runtime ever sees them, and silently dropping
an unknown field is exactly the error the step validator, or the DDL, must report.

There is no exception filter. Errors are small feature-local classes extending the right Nest HTTP
exception, each owning a fixed `{code, message}`:

| Code                                                                                                                                                    | Status    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `ONBOARDING_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `DOCUMENT_UPLOAD_NOT_FOUND`, `CLIENT_WEBHOOK_OUTBOX_NOT_FOUND`, `CONNECTOR_NOT_FOUND`                     | 404       |
| `INVALID_STEP_DATA` (carries the field-error map), `INVALID_DOCUMENT_UPLOAD`, `CONNECTOR_SETTINGS_INVALID` (carries every offending key)                | 400       |
| `WORKFLOW_INVALID` (carries `reason` and, when known, `path`), `WORKFLOW_CONNECTOR_DECLARATION_INVALID` (carries `stepName` and the adapter's `detail`) | 400       |
| `WORKFLOW_SOURCE_KEY_CONFLICT` (carries `sourceKey` and `conflictingWorkflowId`)                                                                        | 409       |
| `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION`, `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED`         | 409       |
| `ASYNC_CALLBACK_RAW_BODY_REQUIRED`, `ASYNC_CALLBACK_PROVIDER_KEY_INVALID`, `ASYNC_CALLBACK_AUTHENTICATION_FAILED` (§5)                                  | 400       |
| `ASYNC_CALLBACK_SIGNATURE_INVALID` — `503` for a configuration-gap reason (missing `callbackAuth`, missing signing secret), `401` otherwise (§5)        | 401 / 503 |
| `WORKFLOW_RETIRED`                                                                                                                                      | 410       |
| `CONNECTOR_NOT_CONFIGURED` — a required credential resolves nowhere at execution time                                                                   | 503       |
| `TWILIO_VERIFY_UNAVAILABLE`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`, `CLIENT_WEBHOOK_DELIVERY_FAILED`                                       | 500       |

_Reasoning_ (`packages/engine/CLAUDE.md`, "Error contracts"): a global error enum becomes a
dumping ground and couples unrelated features. Feature-local classes keep the contract next to the
code that can violate it, and make the semantic status a compile-time choice. Every class also
carries a `static apiDescription`, the one line the OpenAPI document prints beside its code (below).

### Authentication — Microsoft Entra ID on the admin surface

Every route under `/v1/admin/` and the three admin onboarding reads (`GET /v1/onboardings`,
`GET /v1/onboardings/:id`, `GET /v1/onboardings/:id/transitions`) require a verified Microsoft Entra
ID access token, enforced by `AzureJwtGuard` (`packages/engine/src/auth/azure-jwt.guard.ts`) through
the `AdminRoute()` decorator (`packages/engine/src/auth/admin-route.decorator.ts`), which applies the
guard and writes its contract into the OpenAPI document in one step. Every other route — the
customer-facing onboarding flow, `POST /v1/onboardings/:id/review/:action` and provider webhooks —
stays open: there is no Entra identity for an end customer or a provider to hold, so CORS (`main.ts` allows exactly
`ADMIN_PANEL_ORIGIN`, plus origin-less requests, and only
`GET`/`PUT`/`PATCH`/`DELETE`/`OPTIONS`) is that
surface's only constraint, and it constrains browsers, not clients.

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
`docs/decisions/0012-openapi-document-generated-from-decorators.md` records the choice; this section
describes the mechanism.

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
`{ statusCode, message, error }`), the `JsonValue` and `WorkflowCondition` components, the three
domain enum components declared once in `api-enums.ts` (`WorkflowStatus`,
`ConnectorRejectionReason`, `ConnectorType`), and the workflow and node-graph JSON Schemas the DDL
derives in memory — mounted verbatim by `embedJsonSchemaDocument` with their `definitions` relocated
to components, which is why the document is 3.1 rather than 3.0 (3.0's schema subset has no
`if`/`then` or `const`). `toOpenApi31Dialect` then rewrites the one 3.0-ism the decorators still
emit, `nullable: true`, into a `null` type alternative. Tags are per audience (`Onboarding flow`,
`Manual review`, `Provider callbacks`, `Admin: …`, `Health`), declared in `openapi.constants.ts`.

**Errors are documented from the classes that raise them.** `ApiErrorResponses(...)`
(`api-error-responses.decorator.ts`) takes the exception classes a route can throw, constructs each
once and reads its status and `code` off the instance, so the document cannot claim a status or code
the class does not produce; codes are grouped into one response per status with the `code` enum
narrowed to that route. A class whose status depends on its arguments is listed through the
`{ exception, args }` form (`CallbackSignatureInvalidException`, once for `401` and once for `503`).
Refusals the framework answers before the handler — DTO validation, a route pipe, the admin guard —
are listed as `VALIDATION_ERROR` or `frameworkError(status, text)` and documented with the
`NestHttpError` envelope; a status both can produce is documented as either.

**Generation needs no infrastructure.** `testing/create-openapi-app.ts` compiles `AppModule` through
`@nestjs/testing` with TypeORM's `DataSource` provider replaced by a stub and never calls `init()`:
every repository resolves its manager per call and the Redis connection is opened in a lifecycle
hook, so nothing reaches for the network. That is what lets `openapi-document.spec.ts` run in
`pnpm test`: it rebuilds the document and asserts it equals the committed file, then checks
completeness — every one of the 21 routes present, unique `operationId`s, a summary and exactly
one declared tag per operation, one success response with a schema (or a `204`), every path
parameter declared, the bearer requirement on every `Admin:` operation and on nothing else, no
dangling `$ref`, every property typed or deliberately described, and no `nullable` left. What it
cannot see is a response property that was never decorated; that rests on review.
`test/openapi.e2e-spec.ts` checks that the served JSON equals the committed file and that no UI is
served. `.prettierignore` excludes the generated file, since the generator's rendering is the one the
drift test compares byte for byte.

---

## 12. Admin panel

`packages/admin-panel` — React 19, Vite, TanStack Query, Axios, Zod. Three tabs, built from
`ADMIN_SECTIONS` in `src/app/navigation.tsx`: **Onboardings**, a filterable, read-only list
served from `GET /v1/onboardings` with a details page per onboarding; **Audit log**, a
filterable, read-only view of the audit trail (§8); and **Connectors**, the only tab that
writes anything.

The Connectors tab is one card per connector returned by `GET /v1/admin/connectors` — no filters,
no pager — grouped under a heading per `type`, the connector capability from §2. Grouping is the
panel's only use of that field: two providers of one capability sit together, so an operator finds
"the email one" without opening cards. Groups follow the capability order declared in
`features/connectors/types/connector.ts`, an empty capability is omitted, and a capability this
build does not know is kept and appended rather than hidden — the engine owns the set, and dropping
a connector an operator must configure would be worse than an unlabelled heading. That module
imports and re-exports `CONNECTOR_TYPES` from `@tsh/ddl-schema/workflow-contract` rather than
copying it, so the capability set has one definition (see "Connector capabilities are imported, not
copied" below). A card is titled by the adapter's `name` and shows its `id` beneath only
when the two differ, since most adapters name themselves after their id.

Each card is a form for describing a _change_, not the connector's whole
desired state: Save calls the engine's `PATCH` (§4) with only the keys the operator actually
touched, comparing each field's current value back against what it was seeded with. A stored
secret's box always starts empty, because the engine never returns its value, and leaving it
empty means keep the stored value. An empty box is otherwise indistinguishable from an unset one,
so a stored setting is marked three ways: a "Stored" pill, a fixed-width masked placeholder, and
the sentence saying what an empty box will do on save. The mask deliberately does **not** track the
real value's length — the engine never sends it, and sending it would leak the size of a credential
for no operator benefit. Every secret box is a `SecretInput`
(`shared/components/SecretInput.tsx`), shared with the additional-key rows below it: masked and
`autoComplete="new-password"` by default, with an eye button that switches it to `type="text"` so a
long pasted credential can be proof-read before it is saved. It reveals only what the operator has
just entered, and the eye is therefore **disabled while the box is empty** — the engine returns no
stored value, so an enabled toggle on a stored secret could only ever display the mask's own
bullets as though the credential really were a row of dots. Emptying a revealed box falls back to
masked for the same reason. The hint is referenced by `aria-describedby` unconditionally, not only
when a write is refused, so a screen reader is told the engine already holds a credential — it is never sent, so it is never at risk of being
overwritten or dropped. Emptying a _non-secret_ field that had a stored value sends an explicit
`null` for that key. Save is enabled as soon as there is at least one such change — it is never
blocked by a stored secret's box being left empty. Clear is the supported way to remove a
connector's settings — it issues `DELETE` and sits behind an in-card confirmation step, since it
is irreversible.

Decisions worth keeping:

- **No automatic refetching.** `retry: false`, all `refetchOn*` disabled. Data changes only on
  explicit Apply / Reload / Reset. For an operator tool looking at regulated data, a silent
  background refresh that moves rows under a cursor is a defect, not a feature.
- **Zod-validated, explicitly projected responses.** `projectAdminOnboardingSummary` copies exactly
  the lifecycle-safe fields and drops everything else, so a future engine field (notably `context`)
  cannot reach the browser by accident.
- **A fixture-driven e2e harness.** `e2e/run-direct-engine-playwright.cjs` boots
  `test-engine-fixture.cjs`, writes a `.env` pointing the panel at it, then runs Playwright. The
  panel's browser tests exercise the real request path without the Docker stack. Playwright is
  spawned as its own CLI — resolved from `@playwright/test` and run with the Node executable
  already running the harness — rather than through the package manager, because
  `node $npm_execpath exec playwright` assumes the package manager is a JavaScript file and a
  standalone pnpm (`@pnpm/exe`) is a native binary.

- **Configuration is read at runtime, not baked in at build time.** Vite inlines
  `import.meta.env.VITE_*` when the panel is built, which would otherwise mean one image per
  environment. `readRuntimeEnv()` (`src/shared/config/runtime-env.ts`) instead merges
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
  and an absolute one would break the moment `ENGINE_PORT` was remapped. Under `pnpm dev` and in
  Vitest, `window.__ENV__` is never set, so `import.meta.env` alone decides behaviour — unchanged
  from before this mechanism existed.

- **One status list per package.** `ADMIN_ONBOARDING_STATUSES` in
  `src/features/onboarding/types/admin-onboarding.ts` holds the five statuses the engine emits, and
  the Zod response enum, the filter normalizer's guard and the filter dropdown all read it. The
  dropdown's label map is typed `Record<AdminOnboardingStatus, string>`, so adding a status fails
  the build rather than leaving that status unfilterable. The panel keeps its own copy rather than
  importing `WORKFLOW_STATUSES` from `@tsh/ddl-schema`: it has no workspace dependency on the
  engine itself and reaches it over HTTP only. The two `.cjs` e2e harness files carry a
  third copy for the same reason — they are plain CommonJS and cannot import the TypeScript module.

- **Connector capabilities are imported, not copied.** `CONNECTOR_TYPES` is the one domain list the
  panel does _not_ restate: `src/features/connectors/types/connector.ts` imports it from
  `@tsh/ddl-schema/workflow-contract`, and the connectors page groups by its declaration order. That
  subpath is constants and types with no runtime dependencies, so nothing else — `ajv` in
  particular — reaches the browser bundle; importing the package root would. Only the operator-facing
  labels stay local, typed `Record<ConnectorType, string>` so adding a capability upstream fails the
  panel's typecheck until it is given one. This is a deliberate exception to the status list's
  copy-it-locally rule above, taken because a silently drifted capability list would leave a
  connector ungrouped rather than merely unfilterable.

---

## 13. Delivery

**Compose** (`docker-compose.yml`): `postgres:16-alpine`, `redis:7-alpine`, `minio` + `minio-init`
(creates `orchestrator-files` and must exit successfully before the engine is considered ready),
`mailhog` (HTTP UI published; SMTP network-internal only), `engine` (`MODE=api-only`),
`engine-worker` (`MODE=worker-only`, reuses the same image, no separate build),
and `engine-mailhog-test` (a short-lived SMTP integration runner). There is no `admin-panel`
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
`up` additionally runs `engine-mailhog-test`, a one-shot test runner with no place in a dev loop
that declares the same `image:` with a `build:` of its own. An unscoped `up -d` was observed
replacing `tsh-onboarding-conductor-engine:local` with a freshly built image, where the same
command scoped to `engine` recreated the container in under two seconds and left the image
untouched — so the narrow scope is also what keeps entering the loop cheap. `pnpm panel:watch` (`vite build --watch`) then
rebuilds on save; a browser refresh is enough, and the engine neither restarts nor notices. The
overlay is deliberately not `docker-compose.override.yml`, which Compose loads automatically:
`dist` is gitignored, so on a fresh clone that would silently turn every `pnpm stack:up` into a
stack with no panel. Note that `vite build --watch` watches the module graph only — an edit under
`public/` needs a plain `pnpm --filter @tsh/admin-panel build`. This is a development convenience
and changes nothing about how the image ships: `pnpm stack:up` recreates the engine without the
overlay and it serves the baked copy again.

**Scripts** — everything goes through root pnpm scripts, never raw `docker compose` / `jest` /
`playwright`. `pnpm test:e2e` (`scripts/test-e2e.cjs`) brings the stack up with `--wait engine`,
stops `engine-worker`, runs `pnpm -r run test:e2e`, and always tears down in a `finally`. The
worker is stopped because it drains the same outbox the engine's suites assert on: without that
step a developer whose full stack is already up fails a dozen outbox, audit and webhook
assertions on rows already sent, and the run means something different from the same run on a
cold machine. `pnpm openapi:generate` builds `@tsh/ddl-schema` and then rewrites
`packages/shared/openapi/engine.openapi.json` from the engine's decorators (§11) with no Docker
involved; the engine's unit suite fails while that file is stale.

**CI** (GitHub Actions, the only CI system in the repo): Postgres and Redis as service
containers; **MinIO started as a plain `docker run`** because Actions service containers cannot
override an image command and `minio/minio`'s default CMD only prints help — a comment in the
workflow records this and warns against the archived Bitnami image. Then
`corepack enable → install --frozen-lockfile → cp .env.dist .env → lint → typecheck → build →
test:cov → install Playwright chromium → test:e2e:ci → test:mailhog:integration`. The last step
runs `POSTGRES_PORT=55432`: it is the only step that starts the Compose stack, whose `postgres`
container would otherwise try to publish host 5432 and collide with the job's own Postgres service
container.

**Testing**: 88 co-located engine unit spec files, 19 engine e2e spec files (real
Postgres/Redis/MinIO via supertest against a booted Nest app; 18 of them run by default, with
`smtp.e2e-spec.ts` reserved for `pnpm --filter @tsh/engine test:smtp`). Each of those suites starts
its application through `test/e2e-server.ts`, which leaves it listening on one loopback port for
the file: handed a server that is not listening, supertest binds and closes an ephemeral port per
request, and a run's worth of that churn reissues ports under sockets Node still has pooled, so a
request reaches a peer that is gone and fails as a parse error unrelated to what it was testing.
`test/setup-e2e-sockets.cjs` empties the global agents' pools between files for the same reason.
There are also 20 DDL spec files, 45
admin-panel unit spec files under Vitest plus 3 Playwright specs, and one demo-web placeholder spec.
Last observed green: 1375 engine and 442 DDL unit tests, 484 admin-panel unit tests, 297 engine e2e
tests, 15 admin-panel browser tests. **Coverage is measured but the spec's 80%/95% gates are not enforced.**

**Documentation site** (`packages/docs`, `@tsh/docs`; `docs/decisions/0013-docusaurus-documentation-site.md`):
Docusaurus 3, classic preset, skinned with the TSH design system (`src/css/custom.css`, the two
licensed TWK Everett weights under `static/fonts`, an ejected footer and a custom home page; the
design spec is `packages/docs/THEME.md`). Three docs instances: **Guides** (`docs/guides`,
hand-written: introduction, getting started, your first onboarding, configuration, extending), **API**
(`docs/api`, generated from `packages/shared/openapi/engine.openapi.json` by
`docusaurus-plugin-openapi-docs`, grouped by the document's audience tags, plus three hand-written
overview pages) and **Fixtures** (`docs/fixtures`, one page per file in `workflows/fixtures` and
`workflows/built-in` written by `scripts/generate-fixtures.mjs`, which compiles the authored steps the
way the engine does and lists the compiled step map, plus a gallery with connector-type filters). Generated pages are
never committed: `start`, `build` and `typecheck` regenerate them first and `.gitignore` excludes
them, so the spec and the workflow files remain the only sources. Search is
`@easyops-cn/docusaurus-search-local`. The package joins the root `build`, `lint` and `typecheck`
fan-out and the engine image's dependency stage; `pnpm docs:dev` and `pnpm docs:build` build
`@tsh/ddl-schema` first, which the fixtures generator imports; the dev server and `serve` listen on
port 3030 so they never collide with the engine on 3000. Deployment is Vercel with the project root at
`packages/docs` (`vercel.json` there runs the install and build from the repository root); the site
URL comes from `DOCS_SITE_URL` or Vercel's production hostname.

**Governance**: `CLAUDE.md` carries the repository orientation, verified commands and pitfalls
(architecture, naming, KISS, Strategy-only-where-warranted, transaction discipline), with scoped
rules in `.claude/rules/` for code design, domain constants and testing, and per-workspace
`CLAUDE.md` files for the rest. Both are maintained deliberately: when the project changes in a
way they should reflect, they are updated in the same change rather than left to drift. Husky + lint-staged gate commits on ESLint
(`--max-warnings=0`) and Prettier.

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
scoped rules under `.claude/rules/` (code design, domain constants, testing).
