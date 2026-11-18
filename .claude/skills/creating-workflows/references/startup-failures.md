# Workflow failures: reason codes, paths, and what raises them

`validateAndNormalizeWorkflow` compiles the authored document and then validates what it produced,
so a failure comes from one of two phases and they fail differently:

| Phase        | What runs                                                                                                                                                    | What you get                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Authored** | the workflow JSON Schema derived from the step-type registry, then `compileWorkflow` — config parsing, `include`, `substeps`, `edges`, each type's `compile` | a reason **and a `path`**, `steps[3].config.documents[1]`, `steps[0].edges.success`                                                                                                     |
| **Compiled** | the compiled schema and the structural rules of §2 over the steps the types produced                                                                         | a reason and, for a rule checked inside one step (its connectors' field mappings, conditions, transitions, scoring), that step as `steps[i]`; a rule spanning steps carries **no path** |

`pnpm workflow:compile <file>` prints `WORKFLOW_INVALID <REASON> at <path>` and exits 1, which is
the fastest way to read both. `pnpm workflow:validate` reports the same reason.

A path indexes the **authored** document. A compiled-phase failure that carries one has had it
restated as the authored step whose type produced the offending compiled step — a `steps[k]` that
indexes compiled steps never reaches you.

## Localizing a failure that carries no path, or only a step

1. **Diff against the definition you copied.** The offending declaration is almost always inside it.
2. **Read the compiled form.** `pnpm workflow:compile <file> --report` shows each step's
   `compiledStepNames` and ports; the full compile shows the steps the rules are stated over.
3. **Bisect the steps.** Copy the file, delete the back half of `steps` (repointing the remaining
   edges at a terminal step), and re-compile. Repeat on whichever half still fails.
4. **For `UNKNOWN_PROPERTY`, ask the schema which properties exist** at the level you used it. The
   schema is derived in memory, so dump it rather than looking for a checked-in file:

   ```bash
   node -e "console.log(JSON.stringify(require('./packages/shared/ddl-schema/dist/index.js').getWorkflowJsonSchema(),null,2))" | grep -n '<the-property-name>'
   ```

   `getCompiledWorkflowJsonSchema()` is the compiled form's, for what a `custom` step may carry.

## Authored-phase failures

### `INVALID_SHAPE` at `steps[i]`

**A step with no `type`.** This is what an **untyped** document looks like — the compiled shape,
authored directly, as workflows were written before step types. It is reported at the first such
step, not at the root. Run `pnpm workflow:compile <file> --from-untyped` and save what it prints:
the same steps, each wrapped in a `custom` step, compiling back to exactly the document you had.
Migration `0020` does the same to stored rows.

`INVALID_SHAPE` elsewhere is an ordinary schema failure: a missing required property, or a value of
the wrong JSON type, at the path named.

### `INVALID_VALUE`

| Path                             | Cause                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `steps[i].type`                  | No registered step type by that name                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `steps[i].config…`               | The type's own `parseConfig` refused a value — read the type's config schema                                                                                                                                                                                                                                                                                                                                                                               |
| `steps[i].config.connector.type` | The declared connector `type` is outside the step type's slot                                                                                                                                                                                                                                                                                                                                                                                              |
| `steps[i]`                       | A type's `compile` refused: an added `fieldMapping` / `config` key would override one the type derives, a `document-choice` offers a document type no capture step collects, or — by far the most common — `kyc-identity-verification` is missing an applicant attribute (`firstName`, `lastName`, `dateOfBirth`, `nationality`, `country`, `street`, `town`, `postCode`), a questionnaire item or a captured document that **no ancestor step publishes** |
| `steps[i].substeps.<key>`        | The type produces no sub-step by that key. `otp-verify` has `verify` and `resend`; a two-sided `document-capture` has `front` and `back`                                                                                                                                                                                                                                                                                                                   |
| `steps[i].scoring`               | `terminal` and `risk-score` accept no step-level scoring rules                                                                                                                                                                                                                                                                                                                                                                                             |
| `steps[i].include[j].type`       | The included type is not `composable` — only `form`, `contact-details`, `consents`, `identity-profile`, `address` and `questionnaire` are                                                                                                                                                                                                                                                                                                                  |
| `initial`                        | `initial` names no declared step                                                                                                                                                                                                                                                                                                                                                                                                                           |

The contract is scoped to a step's **ancestors** — the steps with an edge path to it. A collector
that sits on one branch of a fork, or after the consumer, is invisible: that is the same
`INVALID_VALUE` at the consuming step, and the fix is to move the collector onto every path.

**A connector `id` is never checked here.** The slot constrains the declared `type` only, and `type`
is itself optional — every checked-in document omits it and takes the slot's default. An id of a
different capability therefore compiles clean and fails at boot with
`WORKFLOW_CONNECTOR_DECLARATION_INVALID`. Declaring `type` moves that failure here, to compile time.

### `INVALID_TRANSITIONS` at `steps[i].edges.<port>`

- A non-optional port with no edge. Only `manual-review`'s `invalid` is optional.
- An `edges` key naming a port the type does not expose. Read the type's port list before guessing.
- More than one arm without a `when`, or an unconditional arm that is not last.

**A group whose arms are all conditional is none of those, and is not a defect.** Nothing requires
an unconditional fallback — `workflows/fixtures/conditional-fields-and-transitions.workflow.json`
ships two review steps whose approve transitions are each a single `when`-qualified arm. It is the
document saying "only this case
advances". Appending a fallback to such a group is a behaviour change, not a fix: with no arm
matching, a **submit** ends the onboarding `invalid` and a **manual** trigger (`manual.approve`,
`manual.reject`, `manual.invalid`) is refused with `MANUAL_TRANSITION_NOT_AVAILABLE`, leaving the
onboarding where it stood. The path names one port — wire that one and leave every other group as
you found it.

### `DUPLICATE_FIELD_NAME` · `DUPLICATE_STEP_NAME` · `UNKNOWN_TARGET`

- `steps[i].include[j]` — a fragment contributes a field name the step already has.
- `steps[i].name` — two authored steps share a name.
- `steps[i].substeps` — a rename collides with another compiled step's name.
- `steps[i].edges.<port>` — an arm's `target` names no authored step. An edge names an **authored**
  step, never a compiled one: write `capture_id_card`, not `capture_id_card_front`.

## Compiled-phase failures

These are stated over the steps the types produced, which is also what a `custom` or
`connector-call` step declares by hand. They carry a reason and, usually, no path.

### `INVALID_SHAPE`

- A condition that is not an object, or an `all` / `any` / `not` key declared alongside any other
  key — each must be the sole key of its object.
- An empty `all` / `any` array, or an empty `in` array.
- A `field` leaf that does not carry exactly one of `equals`, `in`, `isSet` and nothing else.
- A `score` leaf that does not carry exactly one of `gte`, `gt`, `lte`, `lt` and nothing else.
- A `manual.approve` / `manual.reject` / `manual.invalid` transition with no `target`.
- A `rejected` transition whose `reason` is not a non-empty array.
- A root `scoring` that is not an object, or a score declaration that is not an object.

### `UNKNOWN_PROPERTY`

Any key the schema does not know at the level it was used — a typo, a property at the wrong nesting
level, or one from another branch's schema. Two that recur:

- `persist` on a nested field, where it is root-only.
- A `score` comparison in a `when` where no score is in scope. Only a **transition's** (and so a
  conditional edge's) `when` may name a score; a field's `when` and a scoring rule's own `when` may
  not, because a field condition is published to the client through `/state` and the score leaf
  resolves server-side only.

### `INVALID_VALUE`, by area

**Fields**

- A `type` no field type in the registry claims (`packages/shared/ddl-schema/src/fields/`).
- A field descriptor that is not an object.
- More than one `file` field in a single compiled step — which is why a two-sided document is two
  compiled steps.

**Conditions**

- `field` names something that is not a declared root field anywhere in the document.
- A field's own `when` references that same field, or a cycle exists among field `when` dependencies.
- A literal in `equals` / `in` whose type disagrees with the referenced field's type.
- `isSet` is not a boolean.
- A `score` leaf naming an undeclared score, or a threshold that is not an integer.

**Connectors**

- An empty `name` or `id`, or a `type` outside the connector-type vocabulary.
- An `order` that is not a positive integer, or one repeated within the same step.
- A `config` that is not a plain JSON-compatible object.
- A `fieldMapping` source that is not a declared field.
- A **required** cross-step source declared in a step that does not always run before this one.
  Only `optionalFieldMapping` is exempt — that exemption is what lets capture steps sit on separate
  branches of a conditional edge.
- Any cross-step source declared `persist: false`. An unpersisted cross-step source is absent on
  every path, so this is an authoring error rather than optionality.
- The same payload key in both `fieldMapping` and `optionalFieldMapping`, checked against the
  resolved pair — either side may have been inherited from the primary.
- A `retry` outside `maxAttempts` 1–5 or `delayMs` 0–5000.
- A `fallback` entry repeating an `id` already in the chain, declaring a `type` other than the
  primary's, or a chain longer than three entries.

**Scoring**

- A score's `min` or `max` is not an integer, or `min >= max`.
- A rule's `score` names an undeclared score, or its `add` is not an integer, or `add` is `0`.
- A step declares `scoring` while the document declares no scores at all.

**Webhooks**

- A root `webhook` without `notify`, or a `notify.path` that is empty, not trimmed, or has a segment
  that is `.`, `..`, or contains anything outside `A-Za-z0-9._~-`.
- An edge arm's `webhook` whose `notify` is anything other than exactly `false`.

**Rejection reasons**

- A `reason` entry outside `ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`, `CHALLENGE_NOT_FOUND`,
  `CONNECTOR_REJECTED`, or the same reason listed twice.

**Loader**

- Two files declare the same `id` **and** `version`, in whichever scopes they sit.

### `DUPLICATE_STEP_NAME` · `DUPLICATE_FIELD_NAME`

Two compiled steps share a name, or two fields do. Field names are unique across the **whole
document**, generated ones included — which is also why only one step per document can declare the
field set an async callback submits, and so why a document holds at most one
`kyc-identity-verification` step.

### `DUPLICATE_TRANSITION`

More than one unconditional arm within one status group. An arm counts as conditional if it carries
`when` or `reason`.

### `INVALID_TRANSITIONS`

- A non-terminal compiled step declares no transitions at all.
- An unconditional arm is not the last arm in its status group.
- A `manual.*` arm targets its own step.
- `reason` appears on a transition whose status is not `rejected`.
- No connector on the step can reject, yet the step carries a reason-qualified `rejected` arm, or an
  unqualified `rejected` arm targeting a step other than itself.
- A connector on the step can reject, yet there is no unqualified `rejected` arm, or that arm has no
  `target`, or its target is not a step whose status is `rejected`. A refusal must always be able to
  reach a terminal rejection.

### `UNKNOWN_TARGET` · `INVALID_TERMINAL_STEP`

A transition's `target` names no compiled step; or a step whose status is `approved`, `rejected` or
`invalid` declares `data` or `transitions`, or the `initial` step is one of those statuses. Both are
reachable only through a `custom` step — `terminal` cannot produce either.

## Beyond the DDL: what only a running engine checks

A clean compile does not mean a clean boot. `WorkflowRegistryService.onModuleInit` additionally
checks that each connector `id` names a **registered adapter**, that the declared `type` agrees with
that adapter, whatever the adapter's own `validateDeclaration` asserts (for `sumsub_kyc`: a `levelName`, and every
`documents[].payloadField` and `countryField` is a mapped key), and that no two workflows claim the
same `sourceKey`. Those surface as `WORKFLOW_CONNECTOR_DECLARATION_INVALID` and
`WORKFLOW_SOURCE_KEY_CONFLICT`, not as `WORKFLOW_INVALID`.

`POST /v1/admin/workflows/compile` runs every one of these against the running engine and stores
nothing, which is the fastest way to get all of them at once.

## Nothing is wrong with your file

`WorkflowRegistryService.onModuleInit` publishes the definition files, then reads back **every**
stored row and validates that too. A row published while another branch was checked out carries that
branch's shape, and the container exits 1 — `pnpm stack:up` shows `dependency failed to start` for
`engine`. The `postgres-data` volume survives `pnpm stack:down`, which is why the row is still there.

The signature is `pnpm workflow:validate` passing on every file while the engine refuses to boot.
Compare the table against the files on disk before reading any code:

```bash
docker exec tsh-onboarding-conductor-postgres-1 psql -U orchestrator -d orchestrator -c "select workflow_id, version, status, scope from workflows;"
```

A `workflow_id` in the table with no matching file under `workflows/` is the orphan. Delete those
rows specifically. Do not reach for `docker compose down -v`, which destroys the whole local
database including onboardings and audit rows that may still be wanted. Leftover `onboardings` rows
referencing a deleted workflow are harmless — startup never validates them.
