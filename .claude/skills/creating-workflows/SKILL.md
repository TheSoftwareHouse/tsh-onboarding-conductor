---
name: creating-workflows
description: "Creates and revises the engine's JSON onboarding workflow definitions under workflows/ — choosing the scope, starting from the closest existing definition, declaring steps, fields, connectors, transitions and scores, validating without booting the stack, and publishing a change as a new version. Use when adding an onboarding flow, adding a step or connector to one, or diagnosing a workflow that fails engine startup."
when_to_use: "Trigger on: adding or editing a *.workflow.json file under workflows/, 'add a new onboarding flow', 'add a step / field / connector / transition / score to a workflow', wiring a KYC, email or SMS provider into an existing flow, changing what a flow collects or where it routes, publishing a new version of a flow, choosing between workflows/built-in, workflows/fixtures and workflows/users, or an engine that exits with WORKFLOW_INVALID or WorkflowInvalidError at startup."
---

# Creating a workflow definition

A workflow is a JSON document under `workflows/`, validated at engine startup and served from the
`workflows` table afterwards. The work is mostly **declaration against a fixed vocabulary**, so the
expensive mistake is writing from an empty file: every part of the DDL already has a worked example
in the repository, and the validator reports a coarse reason with no path when a hand-written
document is wrong.

## Applicability and precedence

`docs/EXTENDING.md` ("Add a workflow") and `docs/IMPLEMENTATION.md` (§2 The DDL) are the as-built
specification and **outrank this skill**. This skill owns the order of work, the rules that block
review, and the failure lookup — not the vocabulary. Where the two disagree, follow the documents
and fix this skill.

This skill does not cover: writing a connector adapter, field type, error handler, SSO provider or
email template — those are code changes with their own sections in `docs/EXTENDING.md`. Nor does it
cover connector credentials, which an operator sets in the admin panel's Connectors tab, never in a
workflow document or an environment variable.

## Non-negotiable rules

| Severity | Rule                                                                                                                                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MUST     | Start from the closest existing definition and diff against it. Never write a document from an empty file.                                                                                                                      |
| MUST     | Run `pnpm workflow:validate <path>` before starting the stack. It is seconds; a failed bootstrap is minutes.                                                                                                                    |
| NEVER    | Change a stored revision's behaviour by editing it. Publish by adding a file with the same `id` and a higher `version` — onboardings in flight stay pinned to the version they started on.                                      |
| MUST     | Keep field names unique across the **whole** document, not per step. A repeat is `DUPLICATE_FIELD_NAME`.                                                                                                                        |
| MUST     | Declare a required cross-step `fieldMapping` source in a step that **always** runs before the connector's step, and leave it persisted. Only `optionalFieldMapping` is exempt from the ordering rule, and never from `persist`. |
| MUST     | Declare every field an `async: true` connector's callback can submit on the step that parks. An undeclared key is an `UNKNOWN` field error that loses the verdict.                                                              |
| MUST     | Within one status group, put at most one unconditional arm and put it last. Prefer exhaustive conditions with no unconditional arm over an "everything else" arm that silently absorbs a value added to an enum later.          |
| NEVER    | Give a terminal step (`approved`, `rejected`, `invalid`) any `data` or `transitions`, and never make one the `initial` step.                                                                                                    |
| NEVER    | Invent a connector `id`, a `type`, an `errorHandler` or a field `format`. Read the registry (step 3) — the DDL accepts an unregistered `id` and the engine rejects it later.                                                    |
| NEVER    | Name a test double after a real or plausible vendor. A fixture connector announces itself as a mock in its `id`, as `mock_kyc_1` and `mock_email_delivery` do.                                                                  |
| MUST     | Update `docs/IMPLEMENTATION.md` (§"Checked-in workflows") and `docs/EXTENDING.md`'s example list in the same change that adds or removes a committed workflow.                                                                  |

## Gotchas

Each of these produces a document that validates, and three of them a document that boots, while
being wrong. None is inferable from the DDL.

- **`retry` without `errorHandler` is a silent no-op.** The default `fallback_on_error` returns
  `PROPAGATE` on the first failure when no `fallback` is declared, so the attempts are never spent.
  A slot that should retry names `errorHandler: "retry_then_fallback"`, with or without a chain.
- **An `async: true` primary constrains its whole chain.** Every `fallback` entry's adapter must
  declare `supportsAsyncCallback`, or startup throws. No registered `kyc` adapter other than
  `sumsub_kyc` does, so a Sumsub slot takes retries and no fallback.
- **A `kycRetryStep: APPLICANT_DATA` arm goes to manual review, never back to a collection step.**
  `createApplicant` returns the _existing_ applicant on a repeat `externalUserId` and the adapter
  cannot update `fixedInfo`, so re-collected personal data could never reach Sumsub — the arm would
  ask the customer to retype into a void. `IDENTITY`, `SELFIE` and `QUESTIONNAIRE` do return to the
  step that owns the data, and each pairs `kycRetryStep` with `kycOutcome` in an `all` block,
  because a `kycRetryStep` from an earlier pass survives in context.
- **A manual-review step needs a recursive `{"status": "success"}` arm.** `canSubmit: false` is
  advisory and the submit endpoint does not enforce it, so without one a stray empty POST resolves
  to no transition and ends the onboarding terminal `invalid`.
- **Never recover from `ATTEMPTS_EXHAUSTED` in a `reason` filter.** A fresh verification resets the
  provider's attempt counter, so routing it back to a resend step is an unbounded SMS-sending loop
  — a pumping-fraud vector, not a usability fix. `CHALLENGE_EXPIRED` and `CHALLENGE_NOT_FOUND` are
  the two that may recover.

## Reference loading

| Reference                                          | Load when                                                                              | Covers                                                                                                                                                          |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Startup failures](references/startup-failures.md) | `pnpm workflow:validate` or the engine reports a `WORKFLOW_INVALID` reason, every time | Each reason code mapped to the checks that raise it, how to localize the offending declaration, and the orphaned-row case where nothing is wrong with your file |
| `docs/EXTENDING.md` → "Add a workflow"             | Before declaring anything the example you copied does not already show                 | Scopes, connector declarations, `fallback` and `retry`, rejection reasons, scoring, async callbacks, revisions                                                  |
| `packages/engine/docs/step-data-validation.md`     | Adding or changing a field's type or `validation`                                      | Root and structured field types, root-only `persist`, text formats, selection semantics                                                                         |
| `docs/IMPLEMENTATION.md` → §2, §4                  | The semantics behind a rule are needed, or a connector's own config is in question     | Statuses and triggers, connector types, load and validation, revision status, registered adapters                                                               |
| `docs/IMPLEMENTATION.md` → §"Checked-in workflows" | **Before declaring** a `sumsub_kyc` step, a resend path or a manual-review step        | Why each committed workflow routes the way it does — the engine-behaviour rules behind the gotchas below, worked through on the built-in flow                   |

## Procedure

**Step 1 — Pick the scope.** `built-in/` is shipped with the engine and loaded everywhere;
`fixtures/` backs local development and CI and is skipped when `NODE_ENV=production`; `users/` is a
deployment's own. A definition demonstrating a DDL feature belongs in `fixtures/`; a production flow
belongs in `built-in/`. Ask when the request does not make it obvious.

**Step 2 — Start from the closest existing definition.** Copy it to
`workflows/<scope>/<id>.workflow.json` and change what differs:

| Closest to                                 | Copy                                                                          |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| A plain linear flow                        | `fixtures/base.workflow.json`                                                 |
| Branching on what the applicant answered   | `fixtures/conditional-fields-and-transitions.workflow.json`                   |
| Document or image capture                  | `fixtures/file-upload.workflow.json`                                          |
| An operator decides the outcome            | `fixtures/manual-review.workflow.json`                                        |
| Calling an arbitrary HTTP API              | `fixtures/http-request.workflow.json`                                         |
| One-time code over SMS, with a resend path | `fixtures/twilio-verify.workflow.json`                                        |
| Sending email                              | `fixtures/sendgrid-email.workflow.json`, `fixtures/manual-smtp.workflow.json` |
| A provider that answers on a callback      | `fixtures/sumsub-kyc.workflow.json`                                           |
| Named scores and score-conditioned routing | `fixtures/scoring.workflow.json`                                              |
| A second provider behind the first         | `fixtures/connector-fallback.workflow.json`                                   |
| A production flow, end to end              | `built-in/eu-b2c-individual-kyc-eea.workflow.json`                            |

**Step 3 — Reconcile every declared identifier against the registry.** Provider values that have
actually been made to work are recorded in `workflows/fixtures/` — diff a failing `config` against
the fixture's rather than asking which value is right.

```bash
grep -rn "readonly id = \|readonly type = " packages/engine/src/connectors/adapters packages/engine/src/connectors/error-handlers
```

Read the `type`s, not just the `id`s, whenever a `fallback` is in question: a chain entry must
repeat the primary's `type` with a different `id`, so a slot can only have one at all where two
adapters share a capability. Today `email_delivery` is the only capability with two non-mock
adapters — a `phone_verification` or `kyc` chain can be backed by a fixture mock, which confines
the definition to `fixtures/`, or by nothing.

**Step 4 — Declare.** Root first (`id`, `version`, `name`, `initial`, optional `webhook` and
`scoring`), then each step's `data`, `connectors` in `order`, `transitions`, and any `scoring`
rules. Two limits that are easy to hit: at most one `file` field per step, and at most one
`sumsub_kyc`-parked step per document.

**Step 5 — Validate.** `pnpm workflow:validate` checks every scope; pass a path to check one file.
If it reports the package is not built — or warns that the build is older than its sources — run
`pnpm --filter @tsh/ddl-schema build` and validate again. To see what one document compiles to
rather than only whether it loads, run `pnpm workflow:compile <file> [--report|--normalized]`. On a
failure, read
[references/startup-failures.md](references/startup-failures.md) rather than guessing at the
document.

**Step 6 — Prove it against the engine.** Validation covers the DDL only. That a connector `id`
names a registered adapter, that its `type` agrees with that adapter, and whatever the adapter's own
`validateDeclaration` asserts are checked by `WorkflowRegistryService.onModuleInit` — so bring the
stack up with `pnpm stack:up` and confirm the revision reached the table:

```bash
docker exec tsh-onboarding-conductor-postgres-1 psql -U orchestrator -d orchestrator -c "select workflow_id, version, status, scope from workflows;"
```

A healthy container is not the check — a registry failure exits the container, but a `stack:up` that
raced ahead of it still looks fine. Do not reach for `pnpm stack:logs`: it follows and never
returns. Use `docker logs tsh-onboarding-conductor-engine-1` when the row is missing.

A committed workflow that demonstrates a DDL feature also gets a co-located fixture spec following
`packages/engine/src/workflows/*-workflow-fixture.spec.ts`: read the file from disk, normalize it,
and assert the feature it exists to demonstrate. Run it with `pnpm test`.

**Step 7 — Document, then report.** Update the two documents named in the rules table, run
`pnpm format:fix`, and say which scope the definition landed in and which existing definition it
started from.

## Self-check before handoff

```text
- [ ] The document started from a named existing definition, not an empty file
- [ ] `pnpm workflow:validate` passes, and the engine boots with the definition loaded
- [ ] Every connector `id`, `type`, `errorHandler` and field `format` exists in a registry
- [ ] Field names are unique across the whole document
- [ ] Every required cross-step source is persisted and declared in a guaranteed predecessor
- [ ] Every field an async callback can submit is declared on the parked step
- [ ] Each status group has at most one unconditional arm, last
- [ ] A behaviour change was published as a new `version`, not an edit to a stored one
- [ ] `docs/IMPLEMENTATION.md` and `docs/EXTENDING.md` reflect the change
```
