# Onboarding Orchestrator — What Is Actually Built

**Status:** describes `main` at `2d7461a` (2026-08-18).
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
2. **A single homogeneous step shape.** There are no step types. A step has data, connectors and
   transitions; any of them may be empty. Async waiting, manual review and terminal states are all
   the same shape with different content.
3. **Fail at startup, not at a user's request.** Workflow JSON, connector declarations, HTTP
   connector secret references, callback-auth declarations and config are all validated at boot.
   A misconfiguration takes the process down rather than surfacing as a 500 on someone's
   onboarding.

### Packages

| Package                                          | State                  | Role                                                                                                                                  |
| ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine` (`@tsh/engine`)                | **Substantive**        | The orchestrator. All business logic.                                                                                                 |
| `packages/shared/ddl-schema` (`@tsh/ddl-schema`) | **Substantive**        | The workflow contract: JSON Schema, normalizer, validators, field-type and format registries. Framework-free, consumed by the engine. |
| `packages/admin-panel` (`@tsh/admin-panel`)      | **Working slice**      | React 19 + Vite read-only onboarding list. Talks to the engine directly.                                                              |
| `packages/demo-bff`                              | **Empty placeholder**  | Name/version only. No source.                                                                                                         |
| `packages/demo-web`                              | **Skeleton**           | A Playwright config and one placeholder spec. No app.                                                                                 |
| `packages/shared`, `packages/shared/openapi`     | **Empty placeholders** | Placeholder exports.                                                                                                                  |

The split between `engine` and `ddl-schema` matters: the DDL package has no Nest dependency and no
HTTP concerns, so the workflow contract can be consumed by a future BFF, admin UI, or a workflow
authoring tool without dragging the engine in.

---

## 2. The DDL (workflow definition language)

Canonical types: `packages/shared/ddl-schema/src/workflow-contract.ts`.
Reference docs: `packages/engine/docs/step-data-validation.md`,
`packages/shared/ddl-schema/docs/extending-field-types.md`.

```jsonc
{
  "id": "base",
  "version": 1,
  "name": "Base",
  "initial": "collect_email", // optional; defaults to the first step
  "webhook": { "notify": { "path": "notify" } }, // optional outbound notification target
  "steps": [
    {
      "name": "collect_email",
      "status": "awaiting_user", // the onboarding status while this step is active
      "data": {
        "email": { "type": "text", "required": true, "validation": { "format": "email" } },
      },
      "connectors": [
        {
          "name": "tsh_kyc_1",
          "type": "mock_kyc_1",
          "order": 1,
          "fieldMapping": { "email": "email" },
        },
      ],
      "transitions": [
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
`manual.reject`, `manual.invalid`. A transition without a `target` is **recursive** — the step is
retained and awaits the next submit.

_Reasoning:_ the spec's twelve-value status enum mixed durable states with engine-transient ones
(`awaiting_webhook_ack`, `awaiting_provider_callback`). Collapsing to five values that are all
workflow-declarable means the status column has exactly one writer — the active step — and no
engine state leaks into a value clients branch on. Async waiting is expressed by _staying on the
step_, which needs no status of its own.

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

### Load and validation

`WorkflowFileLoaderService` reads `*.json` directly inside each scope directory — no recursion, no
other formats. Each file is parsed, validated and normalized by `validateAndNormalizeWorkflow`, and
`WorkflowRegistryService.onModuleInit` upserts the results into the `workflows` table keyed by
`(workflow_id, version)`. It then loads every stored revision once and hands its connector
declarations to each adapter's `validateDeclaration`. Anything wrong — unreadable directory,
malformed workflow, unknown transition target, duplicate step name, duplicate workflow id,
unresolvable `{{secrets.*}}` reference, invalid `http_request` config — throws during startup.

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

Beyond the JSON Schema, `validateAndNormalizeWorkflow` enforces a set of semantic invariants. They
are worth knowing before authoring a workflow, because each one is a startup failure:

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

- Within one status group, a conditional transition requires an unconditional fallback, and that
  fallback must be **last**: outcome statuses (`success`, `rejected`) need exactly one, manual
  statuses at most one. Two unconditional transitions of the same status are a
  `DUPLICATE_TRANSITION`. This is what guarantees the first-match resolution at runtime cannot
  fall through to nothing.
- A manual transition must declare a `target` and may not target its own step.
- `canReject` is a real routing rule, not documentation: if no connector on the step declares
  `canReject`, a `rejected` transition may only self-loop; if one does, the step **must** declare
  a `rejected` transition and every such transition must target a step whose status is `rejected`.

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

### Checked-in example workflows (`workflows/`)

Each file exists to exercise one mechanism end-to-end, and the e2e suites use them as fixtures:

| File                                 | Demonstrates                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `base`                               | Multi-step chain, two connectors on one step, root notify webhook, per-transition suppression |
| `conditional-fields-and-transitions` | `when` on fields and on transitions, `persist: false`, branching manual review                |
| `email-otp`, `sms-otp`               | Two-step generate/verify with a rejecting connector and attempt budget                        |
| `twilio-verify`                      | The same shape against a real provider                                                        |
| `sendgrid-email`                     | Dotted `fieldMapping` targets (`dynamicTemplateData.first_name`)                              |
| `manual-smtp`                        | Local MailHog send with an HTML template from connector config                                |
| `file-upload`                        | `file` field plus the document reservation flow                                               |
| `http-request`                       | The generic HTTP connector with placeholders, query, and error statuses                       |
| `manual-review`                      | All three manual triggers and a recursive `success` transition                                |

---

## 3. Runtime evaluation

`packages/engine/src/workflows/domain/` — deliberately free of Nest decorators and HTTP types, per
`.claude/rules/engine-architecture.md`.

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
   - `Step.resolveTransition(trigger, transitionContext)` picks the **first** transition whose
     status matches and whose `when` holds. Order in the JSON is the precedence, and the load-time
     fallback rule (§2) guarantees an unconditional last entry exists for outcome statuses, so a
     matching trigger cannot fall through to nothing.
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
throwing — so an operator's bad request is still evidence.

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
  "type": "twilio_verify", // resolves to a registered adapter
  "order": 1, // execution order within the step
  "async": false, // true → initiate, park, resume on callback
  "canReject": true, // this call may reject; constrains the step's `rejected` routing
  "fieldMapping": { "recipient": "phoneNumber" }, // payloadKey → context/field name
  "config": { "operation": "startVerification" },
} // adapter-specific, validated at load
```

### The port

`ConnectorAdapter` (`ports/connector-adapter.port.ts`) is one interface for every provider:
`name`, `type`, optional `supportsAsyncCallback` + `callbackAuth`, optional `validateDeclaration`,
required `execute`, optional `mapCallbackResult`.

`execute` receives `{ declaration, execution: {onboardingId, stepName}, context, payload,
payloadFieldSources }` and returns a `ConnectorExecutionResult`: `accepted` | `rejected(reason)` |
`invalidData(errors, metadata)` | `pending(...)` | `invalid(...)`.

_Reasoning:_ the spec defined seven connector _categories_, each with its own interface (`KycConnector`,
`PhoneVerifyConnector`, …) plus a registry resolving `(category, providerId)`. That was replaced by
one flat interface and resolution by `type`. Categories bought nothing the workflow author could
not express: a step already declares which connector runs and what data it gets, and the engine
never needs to know that a call "is KYC". Meanwhile categories cost a taxonomy that every new
provider must be forced into. Removing them is what makes `http_request` possible at all — a
generic connector has no category.

`fieldMapping` is the only channel from onboarding data into a connector, and what it may name is
settled at load time: the source field must be written in the same step, or in a step that every
path from `initial` passes through and that persists the value (§2). A mapped source field missing
from the context at runtime still throws `ConnectorPayloadFieldNotFoundError`, but that is a
backstop rather than the primary check.

_Reasoning:_ connectors should never see fields a step did not declare; this makes the data flow
into a third party auditable by reading the workflow JSON alone. Proving reachability with a
dominator analysis rather than trusting the author is what lets that audit be static — a workflow
whose connector could be reached down a branch that never collected its inputs fails to load
rather than failing on someone's onboarding.

### Execution and chaining

`WorkflowConnectorExecutorService` sorts declarations by `order` and runs them sequentially. The
first non-`accepted` result short-circuits and becomes the step's outcome. On `async: true` the
adapter's `execute` initiates the work; if it accepts, the executor returns
`pending({connectorName, connectorType, connectorOrder})` and the remaining connectors are
**not** run.

`resume(...)` re-enters the chain with a completed connector's order and result, skipping
everything at or below it. That is the whole resumption mechanism: the parked onboarding stays on
its step, and the callback replays the same evaluation with the missing piece supplied.

Startup assertions in `ConnectorsModule`: connector `type` values must be unique across adapters,
and any adapter with `supportsAsyncCallback: true` must declare `callbackAuth`.

### Operator-provided settings

An adapter may declare a `settingsSchema` on `ConnectorAdapter` — a list of
`{key, secret, required, pattern?}` fields, plus an `allowAdditionalKeys` flag for a connector
whose keys are named by workflow JSON rather than by the adapter. `pattern` is an optional
`RegExp` a submitted value must match, checked in the same collect-all-issues validation as every
other rule; only `twilio_verify.verifyServiceSid` and `sendgrid_email.from` declare one today. An
adapter with no `settingsSchema` is not configurable and does not appear on the admin API below.

Each key resolves in this order at **execution time**:

```
stored value (connector_settings row) → unset
```

The database is the **only** source. There is no environment fallback: a credential absent from
`connector_settings` is unconfigured, full stop, and raises `503 CONNECTOR_NOT_CONFIGURED` —
distinguishable from a provider outage. `ConnectorSettingsService.resolve(adapter)` does the
resolving; it depends only on the repository and `DataSource`, never on
`CONNECTOR_ADAPTER_COLLECTION` — an adapter passes itself (`resolve(this)`) rather than a type
string, so it never needs a registry lookup to find its own schema. Turning a `connectorType`
string into an adapter is instead `ConnectorSettingsAdminService`'s job, reached only from
`ConnectorsController`; giving the resolution path that same dependency would close a cycle,
since the adapter registry's factory already injects every adapter.

Declared schemas:

| Type             | Keys                                                                                                                  | `allowAdditionalKeys` |
| ---------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `sendgrid_email` | `apiKey` (secret, required), `from` (required, must match an email-address `pattern`)                                 | no                    |
| `twilio_verify`  | `accountSid` (required), `authToken` (secret, required), `verifyServiceSid` (required, must match `^VA[A-Za-z0-9]+$`) | no                    |
| `smtp`           | `username`, `password` (secret) — neither required alone, but one without the other is rejected                       | no                    |
| `http_request`   | none                                                                                                                  | yes                   |

Stored values are one flat `Record<string, string>` per connector type, held as plaintext JSON in
the `connector_settings` table (`connector_type` primary key, `settings jsonb`, `updated_at`,
`updated_by`) — see §9. **Confidentiality at rest is the database's responsibility, not the
engine's**: there is no crypto module and no encryption key, and a dump, a replica or any `psql`
session exposes every connector credential in clear (see §10 and the decision record). There is
no cache: every execution re-reads the row, so a credential submitted over the admin API takes
effect on the next call on every instance without a restart.

`http_request`'s keys are dotted (`{{secrets.kycProvider.token}}` stores as
`kycProvider.token`); the connector expands the flat map into the nested shape it already
consumes. There is no environment map to merge over — the stored value is the only one.

Four guarded routes, all behind `AzureJwtGuard`, form the admin surface:

| Method | Path                                  | Does                                                |
| ------ | ------------------------------------- | --------------------------------------------------- |
| GET    | `/v1/admin/connectors`                | Lists every configurable connector's settings state |
| GET    | `/v1/admin/connectors/:connectorType` | Reads one connector's settings state                |
| PUT    | `/v1/admin/connectors/:connectorType` | Replaces its stored settings wholesale              |
| DELETE | `/v1/admin/connectors/:connectorType` | Drops the stored row, leaving every key `unset`     |

A response's `settings` entries carry `key`, `secret`, `required`, `source` (`stored`/`unset`)
and `value` — `value` is present only when `secret` is `false`; a secret's value never leaves the
engine, not even masked. `PUT`'s body is `{ settings: Record<string, string> }` and rejects with
`400 CONNECTOR_SETTINGS_INVALID` on an undeclared key (unless `allowAdditionalKeys`), a missing
required key, a non-string/empty value, a value that fails a field's declared `pattern` (for
example `twilio_verify.verifyServiceSid` and `sendgrid_email.from`), or — because `PUT` replaces
the map wholesale — a body that silently omits a key that is currently stored. That last case
names every key that would be dropped and is refused unless the request carries `?replace=true`,
the explicit opt-in to drop them. `smtp` additionally rejects `username` or `password` supplied
alone: an unauthenticated SMTP session is a real configuration, but only when neither key is
sent. Every issue is collected and reported at once, naming every offending key. A `connectorType`
naming an unregistered adapter, or one with no `settingsSchema`, answers
`404 CONNECTOR_TYPE_NOT_FOUND`.

### Registered adapters

| Type                             | Kind        | Notes                                                                                                                                   |
| -------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `http_request`                   | **Generic** | Config-driven outbound JSON call. See `packages/engine/docs/http-request-connector.md`.                                                 |
| `twilio_verify`                  | Real        | Twilio Verify start/check; `TwilioVerifyUnavailableException` on provider failure.                                                      |
| `sendgrid_email`                 | Real        | Dynamic-template send; dotted `fieldMapping` keys build nested payloads.                                                                |
| `smtp`                           | Local       | Nodemailer to MailHog; HTML template from `config.templatePath`. Plaintext SMTP is only permitted when the host is literally `mailhog`. |
| `mock_kyc_1`, `mock_kyc_2`       | Mock        | Trivial always-accept connectors used by `base`.                                                                                        |
| `mock_email_otp`, `mock_sms_otp` | Mock        | In-memory OTP challenge with TTL and attempt budget; rejects with `ATTEMPTS_EXHAUSTED` / `CHALLENGE_EXPIRED` / `CHALLENGE_NOT_FOUND`.   |
| `mock_sumsub_file_upload`        | Mock        | Reads a completed document from object storage.                                                                                         |
| `mock_async_callback`            | Mock        | The async/callback reference implementation; declares `callbackAuth: {kind: 'none'}` with a justification.                              |

### The generic HTTP connector

`http_request` performs one synchronous JSON call per step, entirely from `config`. Placeholders
are `{{namespace.path}}` over exactly three namespaces: `payload.<key>` (a `fieldMapping` key),
`secrets.<alias>.<key>` (a stored `connector_settings` key — see "Operator-provided settings"
above; there is no environment fallback), and `execution.onboardingId` / `execution.stepName`.
Response mapping: `2xx` accepts; `4xx` becomes **retryable invalid data**
with field errors read from `response.errorsPath` and translated back from payload keys to
workflow field names via `fieldMapping`; `3xx`/`5xx`/network/timeout throws.

_Reasoning:_ this is the payoff of dropping categories. A provider whose API is plain JSON needs
zero engine code. Three deliberate constraints: there is **no `context` namespace**, so every value
sent must be declared on the step; `response.errorStatuses` exists so a `401` from a rotated
credential is reported as an integration failure rather than blamed on the end user as a field
error; and a `secrets.*` reference's **presence** is checked at **execution** time, not at
workflow-load time — `parseHttpConnectorConfig` takes a `'shape'`/`'resolved'` mode, and only
`'shape'` (used at load) is checked for well-formedness alone. A stored secret arrives at runtime,
so whether it is actually configured is no longer knowable at boot; a reference that resolves
nowhere at execution raises `503 CONNECTOR_NOT_CONFIGURED` rather than failing the workflow load,
the same trade `CONNECTOR_CALLBACK_SIGNING_SECRETS` already made (§5).

---

## 5. Async provider callbacks

`POST /v1/webhooks/:providerKey/callback`, where `providerKey` is the connector `type`.
Full contract: `packages/engine/docs/connector-callback-signatures.md`.

The request path is ordered so that nothing happens before authentication:

1. `main.ts` installs a **raw** body parser for `/v1/webhooks/*` and JSON/urlencoded parsers
   everywhere else. The signature must be computed over the exact bytes the provider signed.
2. Resolve the adapter by `providerKey` (rejected unless `^[a-z0-9_]+$`).
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

Secrets come from `CONNECTOR_CALLBACK_SIGNING_SECRETS`, a JSON map of connector type to one secret
or a list (a list covers a provider-side rotation window). A signed connector with no entry rejects
at request time rather than failing startup — _reasoning:_ a missing deployment secret for one
provider must not take the whole engine down.

Providers that genuinely do not sign declare `callbackAuth: {kind: 'none', justification: '…'}`.
That declaration is required (asserted at startup) but not sufficient: in production such a
connector's callbacks are accepted only if its type is listed in
`CONNECTOR_CALLBACK_UNSIGNED_TYPES`. Outside production they are accepted by default so local and
CI runs work. _Reasoning:_ registering an adapter is not the same as using it, so the code
invariant ("state your posture") and the deployment decision ("this instance accepts unsigned
ingress from X") are separated.

Every failure answers an identical opaque `401 ASYNC_CALLBACK_SIGNATURE_INVALID`. The
distinguishing reason (`signature_mismatch`, `timestamp_out_of_tolerance`, `signing_secret_missing`,
…) goes to the `webhook.inbound_callback_rejected` audit record and never to the caller.

**Documented limits** (verbatim from the connector-callback doc, still true): the callback URL is
guessable so the signature is the only barrier; secrets are keyed by connector _type_, which is
wrong for a generic connector and blocks `async: true` on `http_request` until a per-initiation
callback token exists; there is no replay dedupe inside the timestamp window; HMAC only; epoch
seconds only.

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

A credential write on `/v1/admin/connectors` (§4) records `connector_settings.updated` on a `PUT`
or `connector_settings.deleted` on a `DELETE`, filed under resource type `connector_settings`
with `resourceId` the connector type. Both go through the same closed-set allowlist as every other
action family (`CONNECTOR_SETTINGS_ACTIONS`, asserted by `assertConnectorSettingsChangeAllowed`).
Metadata (`ConnectorSettingsAuditMetadata`) carries `connectorType` and `keys` — the setting **key
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

| Table                   | Purpose                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `onboardings`           | id, workflow id/version, status, current_step, `context` jsonb, expires_at, completed_at, rejection_reason, timestamps             |
| `onboarding_documents`  | reservation lifecycle: staging/final keys, requested vs verified content type/size/etag, expiry                                    |
| `client_webhook_outbox` | delivery state, payload, endpoint, retry policy, lease                                                                             |
| `audit_log`             | occurred_at, actor, action, resource, before/after jsonb, metadata jsonb, unused hash columns                                      |
| `connector_settings`    | `connector_type` primary key, `settings jsonb` (plaintext — confidentiality at rest is the database's), `updated_at`, `updated_by` |
| `_engine_alive`         | trivial table from `0001_init` proving migrations run                                                                              |

Sixteen migrations, `000N_description.ts` with a PascalCase class and a `name` ending in a 13-digit
timestamp (TypeORM parses the last 13 characters). Notable ones: `0004`/`0009` widen the status
check constraint (each verifies no offending rows before narrowing on `down`), `0005` widens size
columns to `BIGINT`, `0011` adds the outbox retry policy, `0012` **drops** the outbox →
onboardings foreign key — the outbox is an independent delivery ledger and must not be deleted by
an onboarding's lifecycle, `0016` creates `connector_settings` with a check constraint that
`connector_type` matches `^[a-z0-9_]+$`, the same shape the callback route already enforces.

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
- `CONNECTOR_CALLBACK_SIGNING_SECRETS`, `CONNECTOR_CALLBACK_UNSIGNED_TYPES` — parsed and rejected
  if malformed.
- SMTP: when enabled, host/port/from are required; `SMTP_SECURE` and `SMTP_STARTTLS` are mutually
  exclusive; **plaintext is permitted only when the host is `mailhog`**, so a production SMTP
  target cannot be configured unencrypted by omission.
- `WEBHOOK_OUTBOX_WORKER_LEASE_MS >= CLIENT_WEBHOOK_TIMEOUT_MS + 5000`.

Timeouts are bounded rather than free-form (`CLIENT_WEBHOOK_TIMEOUT_MS`, `HTTP_CONNECTOR_TIMEOUT_MS`,
`TWILIO_VERIFY_TIMEOUT_MS`, `SMTP_TIMEOUT_MS`: 100–30000).

**No connector credential is declared in `AppConfig` any more.** `TWILIO_ACCOUNT_SID`,
`TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`, `SENDGRID_API_KEY`, `SENDGRID_FROM`,
`SMTP_USERNAME`, `SMTP_PASSWORD` and `HTTP_CONNECTOR_SECRETS` are all deleted outright. There is
also no engine-side encryption key to declare: the engine performs no encryption of its own (§4,
§9). The engine boots with no connector credential configured anywhere; a
workflow that reaches a connector whose required credential has no `connector_settings` row gets
`503 CONNECTOR_NOT_CONFIGURED` at execution time. Every real connector must be configured through
`/v1/admin/connectors` before it can run — nothing is read from `.env` on its behalf.

Host-side Compose ports are all overridable (`POSTGRES_PORT`, `REDIS_PORT`, `STORAGE_S3_PORT`,
`MINIO_CONSOLE_PORT`, `ENGINE_PORT`, `MAILHOG_HTTP_PORT`) while in-network addresses stay fixed;
the README documents each override and its blast radius.

---

## 11. HTTP surface and error contract

| Method | Path                                                                                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/v1/health/live`                                                                                                                                                                      |
| POST   | `/v1/onboardings` — body `{ workflowId }`                                                                                                                                              |
| GET    | `/v1/onboardings` — filters `status`, `workflowId`, `workflowVersion`, `currentStep`, `onboardingId`                                                                                   |
| GET    | `/v1/onboardings/:id` — the admin record for one onboarding                                                                                                                            |
| GET    | `/v1/onboardings/:id/transitions` — the states it moved through, oldest first                                                                                                          |
| GET    | `/v1/onboardings/:id/state`                                                                                                                                                            |
| POST   | `/v1/onboardings/:id/submit`                                                                                                                                                           |
| POST   | `/v1/onboardings/:id/review/:action`                                                                                                                                                   |
| POST   | `/v1/onboardings/:id/documents`                                                                                                                                                        |
| POST   | `/v1/onboardings/:id/documents/:documentId/complete`                                                                                                                                   |
| GET    | `/v1/admin/audit`                                                                                                                                                                      |
| GET    | `/v1/admin/workflows/:workflowId` — optional `version` pins the revision                                                                                                               |
| GET    | `/v1/admin/connectors` — every configurable connector's settings state                                                                                                                 |
| GET    | `/v1/admin/connectors/:connectorType`                                                                                                                                                  |
| PUT    | `/v1/admin/connectors/:connectorType` — body `{ settings: Record<string, string> }`, replaces wholesale; `?replace=true` opts into dropping a currently stored key that the body omits |
| DELETE | `/v1/admin/connectors/:connectorType`                                                                                                                                                  |
| POST   | `/v1/webhooks/:providerKey/callback`                                                                                                                                                   |

A global `ValidationPipe({ whitelist: true, transform: true })` is registered. The submit route is
the deliberate exception: `DynamicSubmitBodyPipe` passes the body through untouched, because
whitelist stripping would delete workflow-configured field names before the runtime ever sees
them — and silently dropping an unknown field is exactly the error the step validator must report.

There is no exception filter. Errors are small feature-local classes extending the right Nest HTTP
exception, each owning a fixed `{code, message}`:

| Code                                                                                                                                            | Status |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| `ONBOARDING_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `DOCUMENT_UPLOAD_NOT_FOUND`, `CLIENT_WEBHOOK_OUTBOX_NOT_FOUND`, `CONNECTOR_TYPE_NOT_FOUND`        | 404    |
| `INVALID_STEP_DATA` (carries the field-error map), `INVALID_DOCUMENT_UPLOAD`, `CONNECTOR_SETTINGS_INVALID` (carries every offending key)        | 400    |
| `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION`, `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED` | 409    |
| `ASYNC_CALLBACK_SIGNATURE_INVALID`                                                                                                              | 401    |
| `WORKFLOW_RETIRED`                                                                                                                              | 410    |
| `CONNECTOR_NOT_CONFIGURED` — a required credential resolves nowhere at execution time                                                           | 503    |
| `TWILIO_VERIFY_UNAVAILABLE`, `SENDGRID_EMAIL_UNAVAILABLE`, `CLIENT_WEBHOOK_DELIVERY_FAILED`                                                     | 500    |

_Reasoning_ (`.claude/rules/engine-http-errors.md`): a global error enum becomes a
dumping ground and couples unrelated features. Feature-local classes keep the contract next to the
code that can violate it, and make the semantic status a compile-time choice.

### Authentication — Microsoft Entra ID on the admin read surface

`GET /v1/onboardings` (the admin list) and `GET /v1/admin/audit` require a verified Microsoft Entra
ID access token, enforced by `AzureJwtGuard` (`packages/engine/src/auth/azure-jwt.guard.ts`). Every
other route — the customer-facing onboarding flow and provider webhooks — stays open: there is no
Entra identity for an end customer or a provider to hold, so CORS (`main.ts` allows exactly
`ADMIN_PANEL_ORIGIN`, plus origin-less requests, and only `GET`/`OPTIONS`) is that surface's only
constraint, and it constrains browsers, not clients.

The spec's API-key scheme (`osk_live_…`, argon2id-hashed, scoped) is unbuilt; Entra SSO is what
shipped instead (`feat: add azure sso for admin panel`).

Configuration (`.env.dist` documents each inline): `ADMIN_AUTH_ENABLED` (default `true`; `false` is
a local-only escape hatch the engine refuses at startup once `NODE_ENV=production`),
`ADMIN_SSO_PROVIDER` (`azure` is the only implemented value — see `docs/EXTENDING.md` to add
another), `AZURE_TENANT_ID` / `AZURE_API_AUDIENCE` (required and validated at startup once auth is
enabled), and `ADMIN_REQUIRED_ROLES` (comma-separated Entra app-role allowlist, default `admin`,
matched case-insensitively against the token's `roles` claim).

A request to either route is refused as:

| Status                  | When                                                                                                                              |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 401 Unauthorized        | No bearer token, or the token fails signature/issuer/audience/expiry verification                                                 |
| 403 Forbidden           | The token verifies but carries none of `ADMIN_REQUIRED_ROLES` — re-authenticating cannot fix this                                 |
| 503 Service Unavailable | Entra's signing key set could not be reached, so the token was never judged — distinguishes an engine-side fault from a bad token |

Every decision on these two routes, granted or refused, is written to the admin access audit trail
(`packages/engine/src/auth/admin-access-audit.port.ts`), so it answers who read admin data, not only
who was turned away.

---

## 12. Admin panel

`packages/admin-panel` — React 19, Vite, TanStack Query, Axios, Zod. One screen: a filterable,
read-only onboarding list served straight from `GET /v1/onboardings` at
`VITE_ENGINE_API_BASE_URL`.

Decisions worth keeping:

- **No automatic refetching.** `retry: false`, all `refetchOn*` disabled. Data changes only on
  explicit Apply / Reload / Reset. For an operator tool looking at regulated data, a silent
  background refresh that moves rows under a cursor is a defect, not a feature.
- **Zod-validated, explicitly projected responses.** `projectAdminOnboardingSummary` copies exactly
  the lifecycle-safe fields and drops everything else, so a future engine field (notably `context`)
  cannot reach the browser by accident.
- **A fixture-driven e2e harness.** `e2e/run-direct-engine-playwright.cjs` boots
  `test-engine-fixture.cjs`, writes a `.env` pointing the panel at it, then runs Playwright. The
  panel's browser tests exercise the real request path without the Docker stack.

- **One status list per package.** `ADMIN_ONBOARDING_STATUSES` in
  `src/features/onboarding/types/admin-onboarding.ts` holds the five statuses the engine emits, and
  the Zod response enum, the filter normalizer's guard and the filter dropdown all read it. The
  dropdown's label map is typed `Record<AdminOnboardingStatus, string>`, so adding a status fails
  the build rather than leaving that status unfilterable. The panel keeps its own copy rather than
  importing `WORKFLOW_STATUSES` from `@tsh/ddl-schema`: it has no workspace dependency on the
  engine's packages and reaches the engine over HTTP only. The two `.cjs` e2e harness files carry a
  third copy for the same reason — they are plain CommonJS and cannot import the TypeScript module.

---

## 13. Delivery

**Compose** (`docker-compose.yml`): `postgres:16-alpine`, `redis:7-alpine`, `minio` + `minio-init`
(creates `orchestrator-files` and must exit successfully before the engine is considered ready),
`mailhog` (HTTP UI published; SMTP network-internal only), `engine` (`MODE=api-only`),
`engine-worker` (`MODE=worker-only`, reuses the same image, no separate build), and
`engine-mailhog-test` (a short-lived SMTP integration runner). `workflows/` is mounted read-only at
`/app/workflows`; a local override file is the documented way to supply custom workflows.

**Image**: multi-stage `node:24-alpine`, non-root `app:app`.

**Scripts** — everything goes through root pnpm scripts, never raw `docker compose` / `jest` /
`playwright`. `pnpm test:e2e` (`scripts/test-e2e.cjs`) brings the stack up with `--wait engine`,
runs `pnpm -r run test:e2e`, and always tears down in a `finally`.

**CI** (GitHub Actions, the only CI system in the repo): Postgres and Redis as service
containers; **MinIO started as a plain `docker run`** because Actions service containers cannot
override an image command and `minio/minio`'s default CMD only prints help — a comment in the
workflow records this and warns against the archived Bitnami image. Then
`corepack enable → install --frozen-lockfile → cp .env.dist .env → lint → typecheck → build →
test:cov → install Playwright chromium → test:e2e:ci → test:mailhog:integration`.

**Testing**: 46 co-located engine unit spec files, 9 engine e2e spec files (real
Postgres/Redis/MinIO via supertest against a booted Nest app), 8 DDL spec files, 8 admin-panel unit
spec files under Vitest plus one Playwright spec, and one demo-web placeholder spec. The engine e2e
suite was last observed green at 162 tests across 8 suites; the admin panel runs 57 unit tests and
3 browser tests. **Coverage is measured but the spec's 80%/95% gates are not enforced.**

**Governance**: `CLAUDE.md` carries the repository orientation, verified commands and pitfalls
(architecture, naming, KISS, Strategy-only-where-warranted, transaction discipline), with scoped
rules in `.claude/rules/` for engine architecture, HTTP errors, configuration, migrations, domain
constants, code design and testing. Both are maintained deliberately: when the project changes in a
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

Four in-repo documents carry reasoning this file only summarizes, and are accurate as written:

- `packages/engine/docs/step-data-validation.md` — field types, `persist`, `connectorData` vs
  `acceptedData`, validation formats.
- `packages/engine/docs/connector-callback-signatures.md` — the inbound callback auth contract,
  including its stated limits.
- `packages/engine/docs/http-request-connector.md` — the generic HTTP connector's config, placeholder
  namespaces, outcome mapping and what it does not support.
- `packages/engine/docs/audit-log-contract.md` — audit reliability tiers, data boundaries and
  non-guarantees.
- `packages/shared/ddl-schema/docs/extending-field-types.md` — how the two registries work and what
  a new field type or text format must respect.

Conventions the codebase is held to live in `CLAUDE.md` and the scoped rules under
`.claude/rules/` (engine architecture, HTTP errors, configuration, migrations, domain constants,
code design, testing).
