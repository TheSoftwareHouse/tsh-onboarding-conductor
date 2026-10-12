---
name: creating-workflows
description: "Creates and revises the engine's JSON onboarding workflow definitions under workflows/ — choosing the scope, picking step types, wiring ports, binding connectors, validating and compiling without booting the stack, and publishing a change as a new version. Use when adding or editing a *.workflow.json file, adding an onboarding flow, adding a step, field, connector, edge or score to a flow, wiring a KYC, email or SMS provider into one, changing what a flow collects or where it routes, publishing a new version of a flow, choosing between workflows/built-in, workflows/fixtures and workflows/users, converting an untyped document, or diagnosing a workflow that fails to compile or an engine that exits with WORKFLOW_INVALID or WorkflowInvalidError at startup."
---

# Creating a workflow definition

A workflow is a JSON document under `workflows/`: a list of **typed steps** wired to each other by
their named output ports. The step types compile to the single step shape the engine runs before
anything validates it, so authoring is declaration against a fixed vocabulary and the expensive
mistake is writing from an empty file. `workflows/built-in/eu-b2c-individual-kyc-eea-v2.workflow.json`
is the reference flow, covering contact, consents, OTP, identity, address, questionnaire,
document choice and capture, selfie, KYC with seven outcomes, manual review, an HTTP call, an
external wait and three terminals.

## Applicability and precedence

`docs/EXTENDING.md` ("Author a workflow with step types", "Add a workflow") and
`docs/IMPLEMENTATION.md` §2 and §2.1 are the as-built specification and **outrank this skill**.
This skill owns the order of work, the rules that block review, and the failure lookup — not the
vocabulary. Where they disagree, follow the documents and fix this skill.

This skill does not cover: writing a step type, connector adapter, field type, error handler, SSO
provider or email template — those are code changes with their own sections in `docs/EXTENDING.md`.
Nor connector credentials, which an operator sets in the admin panel's Connectors tab, never in a
workflow document or an environment variable.

## Non-negotiable rules

| Severity | Rule                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MUST     | Every step declares a `type`. An **untyped** step — the compiled shape, which workflows were once written in — is refused with `INVALID_SHAPE` at that step. Convert with `pnpm workflow:compile <file> --from-untyped`; never hand-write one.                                                                                                                                                                                                                                                                                                                                                                                    |
| MUST     | Start from the closest existing definition and diff against it, whenever one exists. Some step types have no example anywhere — `risk-score` appears in no workflow at all — so where none is close, assemble from `references/step-types.md` and diff the **compiled** output against a fixture instead.                                                                                                                                                                                                                                                                                                                         |
| MUST     | Collect with the **specialized type that owns the data** — `contact-details` for email and phone, `consents` for terms and notices, `identity-profile`, `address`, `questionnaire`. Each publishes canonical fields a later step can consume, where a `form` publishes only what its `canonical` maps; `form` is for what no type covers.                                                                                                                                                                                                                                                                                         |
| MUST     | Run `pnpm workflow:compile <path>` and `pnpm workflow:validate <path>` before starting the stack. Seconds against a minutes-long failed bootstrap, and the compile prints a `path` into the document.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| MUST     | Wire every non-optional port of every step. `manual-review`'s `invalid` is the only optional one, and which ports **exist** is config-dependent (`decision` / `risk-score` gain `default` only with `fallback: true`, `connector-call` gains `rejected` only when a connector can refuse). Read them off `--report` — but note it lists an unwired optional port with `"arms": []` rather than omitting it, so an empty `arms` is a defect only on a required port.                                                                                                                                                               |
| NEVER    | Change a stored revision's behaviour by editing it. Publish by adding a file with the same `id` and a higher `version` — onboardings in flight stay pinned to the version they started on.                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| NEVER    | Add a port, an arm or an outcome the request did not ask for. `manual-review`'s `invalid` is a third terminal, and appending an unconditional arm to a conditional group re-routes what used to fall through — an all-conditional group is legal and deliberate, and `fixtures/conditional-fields-and-transitions.workflow.json` ships two of them. Fixing a reported failure means changing what its `path` names and nothing else.                                                                                                                                                                                              |
| MUST     | Keep field names unique across the **whole** document, not per step, including the names step types generate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| MUST     | Put a step that publishes something a later step consumes on **every** path into that step. The contract is scoped to ancestors, so a collector on one branch is invisible to a consumer reachable from the other.                                                                                                                                                                                                                                                                                                                                                                                                                |
| NEVER    | Invent a connector `id`, `errorHandler`, field `format` or step `type`. Read the registries (step 3) — a binding outside a step type's slot fails at load, and an unregistered `id` passes the DDL and is rejected by the engine later.                                                                                                                                                                                                                                                                                                                                                                                           |
| NEVER    | Name a test double after a real or plausible vendor. A fixture connector announces itself as a mock in its `id`, as `mock_kyc_1` and `mock_email_delivery` do.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| MUST     | Write a new fixture as **one** file, `<id>.workflow.json`, in specialized step types, with `custom` only for a step no type describes. `fixtures/` holds the flows the e2e suites start onboardings on, not a catalogue of examples.                                                                                                                                                                                                                                                                                                                                                                                              |
| MUST     | Give every `kyc-identity-verification` step a `sourceKey` no other **workflow id** claims — whichever `kyc` adapter it binds — and carry it into a new revision **unchanged**: the key names the product at the provider, so two revisions splitting it would split that product's traffic. There are two built-in families, `eu-b2c-individual-kyc-eea` (v1 and v2 both declare `eu_b2c_individual_kyc_eea_v1`) and `eu-b2c-individual-kyc-eea-veriff` (`eu_b2c_individual_kyc_eea_veriff_v1`). Repeating one key across steps inside a single document is legal; a collision between two ids is `WORKFLOW_SOURCE_KEY_CONFLICT`. |
| MUST     | Update `docs/IMPLEMENTATION.md` (§"Checked-in workflows") and `docs/EXTENDING.md`'s example list in the same change that adds or removes a committed workflow.                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

## Gotchas

Each of these produces a document that compiles, and most of them one that boots, while being wrong.

- **`retry` without `errorHandler` is a silent no-op.** The default `fallback_on_error` returns
  `PROPAGATE` on the first failure when no `fallback` is declared, so the attempts are never spent.
  A binding that should retry names `errorHandler: "retry_then_fallback"`, with or without a chain.
- **A `kyc-identity-verification` step's `retry.APPLICANT_DATA` port goes to manual review, never
  back to a collection step.** `createApplicant` returns the _existing_ applicant on a repeat
  `externalUserId` and the adapter cannot update `fixedInfo`, so re-collected personal data could
  never reach the provider — the arm would ask the customer to retype into a void. `retry.IDENTITY`,
  `retry.SELFIE` and `retry.QUESTIONNAIRE` do return to the step that owns the data.
- **A document holds at most one `kyc-identity-verification` step.** It declares the five callback
  fields (`kycOutcome`, `kycAttemptCount` and the rest) the adapter emits, and field names are unique document-wide.
- **`decision` and `risk-score` cost the customer an empty POST.** They collect nothing and the
  engine advances only on a submit. Prefer a specialized step's own ports, or a conditional edge.
- **`otp-verify` sends to a canonical field, not a configured one.** `sms`/`voice` resolve
  `phoneNumber`, `email` resolves `email`; if no ancestor publishes it the document fails at load.
  Set `recipientField` when the value lives under another name.
- **Never route `ATTEMPTS_EXHAUSTED` back to a re-send.** A fresh verification resets the provider's
  attempt counter, so that is an unbounded SMS-sending loop — a pumping-fraud vector, not a
  usability fix. `otp-verify`'s `resendReasons` defaults to the two that may recover,
  `CHALLENGE_EXPIRED` and `CHALLENGE_NOT_FOUND`.
- **A connector binding's `id` is not checked until the engine boots.** The slot constrains the
  declared `type` only, and `type` is optional — every checked-in document omits it and takes the
  slot's default. So an id of the wrong capability compiles clean and fails at startup with
  `WORKFLOW_CONNECTOR_DECLARATION_INVALID`. Declaring `type` moves that to compile time; worth it
  when the slot accepts more than one capability and you are not copying a working example.
- **A compiled step name is client-visible.** Renaming a step, or letting a compound type generate
  `<step>_verify`, changes what a BFF renders. Use `substeps` to keep a name a caller already knows.

## Reference loading

| Reference                                                 | Load when                                                                                                                    | Covers                                                                                                                                                                       |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Step types](references/step-types.md)                    | Before declaring any step whose type the example you copied does not already show, every time                                | Every type's ports, required config and generated field names; presets; `include` / `edges` / `substeps` / `scoring`; the document contract; connector slots and adapter ids |
| [Startup failures](references/startup-failures.md)        | `pnpm workflow:compile` or `workflow:validate` reports a reason, or the engine exits with `WorkflowInvalidError`, every time | Each reason code mapped to the checks that raise it, how to read the `path`, and the orphaned-row case where nothing is wrong with your file                                 |
| `docs/EXTENDING.md` → "Author a workflow with step types" | The vocabulary is in question, or this skill and the document disagree                                                       | The authored form, worked examples, escape hatches                                                                                                                           |
| `docs/IMPLEMENTATION.md` → §2, §2.1, §4                   | The semantics behind a rule are needed, or a connector's own config is in question                                           | Statuses, fields, scoring, the step-type registry, compilation, connector execution                                                                                          |
| `packages/engine/docs/step-data-validation.md`            | Adding or changing a `form` / `custom` / `wait-for-external` field's type or `validation`                                    | Root and structured field types, root-only `persist`, text formats, selection semantics                                                                                      |

## Procedure

**Step 0 — Name the kind of change.** The first move differs, and taking the wrong one is the
expensive mistake:

| The request                                                               | First move                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A new flow                                                                | Step 1.                                                                                                                                                                                                            |
| Changing what a flow that already loads collects, or where it routes      | **Do not edit the file.** Copy it to `<id>-v<n+1>.workflow.json` in the same scope, raise `version`, edit the copy — `eu-b2c-individual-kyc-eea.workflow.json` is version 1 and `-v2` version 2. Then step 4.      |
| A document that will not compile, or an engine that will not boot with it | It never became a revision, so repair it **in place**: `pnpm workflow:compile <file>` for the reason and the `path`, then [references/startup-failures.md](references/startup-failures.md). Step 5 proves the fix. |

**Step 1 — Pick the scope.** `built-in/` ships with the engine and loads everywhere; `fixtures/`
backs local development and CI and is skipped when `NODE_ENV=production`; `users/` is a deployment's
own. A definition a test runs against belongs in `fixtures/`. A production flow belongs in
`built-in/`. Ask when the request does not make it obvious.

**Step 2 — Start from the closest existing definition.** Copy it to
`workflows/<scope>/<id>.workflow.json` and change what differs:

| Closest to                                       | Copy                                                                                                                                                                                                |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A production flow, end to end                    | `built-in/eu-b2c-individual-kyc-eea-v2.workflow.json`                                                                                                                                               |
| A plain linear flow                              | `fixtures/base.workflow.json`                                                                                                                                                                       |
| Branching on what the applicant answered         | `fixtures/conditional-fields-and-transitions.workflow.json`                                                                                                                                         |
| Document or image capture                        | `fixtures/file-upload.workflow.json`                                                                                                                                                                |
| An operator decides the outcome                  | `fixtures/manual-review.workflow.json`                                                                                                                                                              |
| One-time code over SMS                           | `fixtures/twilio-verify.workflow.json`                                                                                                                                                              |
| Sending email                                    | `fixtures/sendgrid-email.workflow.json`                                                                                                                                                             |
| Named scores and score-conditioned routing       | `fixtures/scoring.workflow.json`                                                                                                                                                                    |
| KYC with a provider callback, OTP with a re-send | `built-in/eu-b2c-individual-kyc-eea-v2.workflow.json` (Sumsub, needs a `levelName`), `built-in/eu-b2c-individual-kyc-eea-veriff-v2.workflow.json` (Veriff, no per-workflow keys beyond `sourceKey`) |

Every fixture is written in `custom` steps — the compiled shape, verbatim — so copy one for its
**shape** and then pick each step's type from what the request says it collects.
The built-in `-v2` revisions are the checked-in documents written in specialized step types; read
one beside [references/step-types.md](references/step-types.md) for how
those types are declared. `pnpm workflow:compile <file>` prints what any document compiles to.

**Step 3 — Reconcile every declared identifier against the registries.** Read
[references/step-types.md](references/step-types.md) for the type's ports and slot, then confirm the
adapter ids and error handlers yourself:

```bash
grep -rnE "readonly (id|type) = |super\('" packages/engine/src/connectors/adapters packages/engine/src/connectors/error-handlers
```

Provider values that have actually been made to work are recorded in `workflows/built-in/` and `workflows/fixtures/` —
diff a failing `config` against the checked-in one's rather than asking which value is right.

**Step 4 — Declare.** Root first (`id`, `version`, `name`, `initial`, optional `webhook`, `scoring`
and `meta`), then each step's `type`, `config`, `include`, `substeps`, `scoring` and `edges`. Two
limits that are easy to hit: at most one `file` field per compiled step, and at most one
`kyc-identity-verification` step per document.

**Step 5 — Compile, then validate.** `pnpm workflow:compile <file>` prints the compiled form, or
exits 1 with the reason and the `path` into your document. `--report` prints each step's
`compiledStepNames` and the arms each port leads along — read it to confirm the graph is the one you
drew. `--report` _replaces_ the compiled document rather than adding to it, so checking what a
connector actually receives (a derived `fieldMapping`, a generated `data` block) needs a second,
plain `compile` run. Then `pnpm workflow:validate` (no argument checks every scope; a path checks one file). If
either reports the package is not built, run `pnpm --filter @tsh/ddl-schema build` and retry. On a
failure read [references/startup-failures.md](references/startup-failures.md) rather than guessing.

**Step 6 — Prove what only the engine checks.** That a connector `id` names a registered adapter,
that its `type` agrees with that adapter, whatever the adapter's own `validateDeclaration` asserts,
and `sourceKey` uniqueness are checked by the engine, not the DDL. **A document that declares no
connector leaves none of them** — step 5 and `pnpm test` are its whole proof and the stack is not
worth starting. Where one does, bring it up with `pnpm stack:up`; `POST /v1/admin/workflows/compile`
then runs every one of those checks and stores nothing, the fastest way to get them all at once:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST http://localhost:3000/v1/admin/workflows/compile \
  -H 'Content-Type: application/json' --data-binary @workflows/<scope>/<id>.workflow.json
```

Once the file is in a scope directory, restart the engine and confirm the revision reached the table:

```bash
docker exec tsh-onboarding-conductor-postgres-1 psql -U orchestrator -d orchestrator -c "select workflow_id, version, status, scope from workflows;"
```

A healthy container is not the check — a registry failure exits the container, but a `stack:up` that
raced ahead of it still looks fine. Do not reach for `pnpm stack:logs`: it follows and never
returns. Use `docker logs tsh-onboarding-conductor-engine-1` when the row is missing.

`pnpm test` covers the checked-in documents through `checked-in-workflows.spec.ts`; run it, and read
what it asserts before working around a failure. If Docker is unavailable or the stack will not come
up, finish every check that does not need it and report which proof went unrun — a dependency you
cannot start is not a reason to hand the work back undone.

**Step 7 — Document, then report.** Update the two documents named in the rules table, run
`pnpm format:fix`, and say which scope the definition landed in and which existing definition it
started from.

## Self-check before handoff

```text
- [ ] Every step names a registered `type`; no step is untyped
- [ ] The document started from a named existing definition, and each thing it collects uses the type that owns it
- [ ] `pnpm workflow:compile` and `pnpm workflow:validate` pass, and the engine boots with it loaded
- [ ] `--report` shows the graph that was intended, and the compiled step names a client will see
- [ ] Every non-optional port is wired, no optional one the request never asked for was, and no edge names a port its type does not expose
- [ ] Field names are unique across the whole document, generated ones included
- [ ] Everything a step consumes from the contract is published by an ancestor on every path
- [ ] Every connector `id`, `type` and `errorHandler` exists in a registry and fits the type's slot
- [ ] A new fixture is one file in specialized step types; a `kyc-identity-verification` `sourceKey` is unique across workflow ids and unchanged from the revision it supersedes
- [ ] A behaviour change was published as a new `version`, not an edit to a stored one
- [ ] `docs/IMPLEMENTATION.md` and `docs/EXTENDING.md` reflect the change
```
