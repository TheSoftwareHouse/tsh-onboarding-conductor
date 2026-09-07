# Startup failures: reason codes and what raises them

`validateAndNormalizeWorkflow` throws `WorkflowInvalidError` with one of nine reasons and **no path
to the offending declaration**. This file maps each reason to the checks that raise it, so the
search is over a short list rather than the whole document.

Two failures wear the same reason but have nothing to do with each other: a document you just wrote,
and a stored row from another branch. Read [Nothing is wrong with your
file](#nothing-is-wrong-with-your-file) before editing anything if `pnpm workflow:validate` passes
and the engine still refuses to boot.

## Localizing the failure

1. **Diff against the definition you copied.** `git diff` on a file you changed, or a diff against
   the fixture you started from. The offending declaration is almost always inside it.
2. **Bisect the steps.** Copy the file, delete the back half of `steps` (repointing the remaining
   transitions at a terminal step), and re-validate. Repeat on whichever half still fails.
3. **For `UNKNOWN_PROPERTY`, ask the schema which properties exist** at the level you used it. The
   schema is derived in memory, so dump it rather than looking for a checked-in file:

   ```bash
   node -e "console.log(JSON.stringify(require('./packages/shared/ddl-schema/dist/schema/workflow-json-schema').getWorkflowJsonSchema(), null, 2))" | grep -n '<the-property-name>'
   ```

## `INVALID_SHAPE`

A required property is missing, a value has the wrong JSON type, or a condition is malformed.

- A missing required property, or a value of the wrong type, anywhere in the document.
- A condition that is not an object, or an `all` / `any` / `not` key declared alongside any other
  key — each must be the sole key of its object.
- An empty `all` / `any` array, or an empty `in` array.
- A `field` leaf that does not carry exactly one of `equals`, `in`, `isSet` and nothing else.
- A `score` leaf that does not carry exactly one of `gte`, `gt`, `lte`, `lt` and nothing else.
- A `manual.approve` / `manual.reject` / `manual.invalid` transition with no `target`.
- A `rejected` transition whose `reason` is not a non-empty array.
- A root `scoring` that is not an object, or a score declaration that is not an object.

## `UNKNOWN_PROPERTY`

A property the schema does not know at the level it was used. Usually a typo, a property put at the
wrong nesting level, or a property from another branch's schema.

- Any unrecognized key — including `persist` on a nested field, where it is root-only.
- A condition object carrying a key outside the condition vocabulary.
- A `score` comparison in a `when` where no score is in scope. Only a **transition's** `when` may
  name a score; a field's `when` and a scoring rule's own `when` may not, because a field condition
  is published to the client through `/state` and the score leaf resolves server-side only.

## `INVALID_VALUE`

The catch-all, and the reason worth searching by area rather than reading top to bottom.

**Root and steps**

- `initial` names no declared step, or `initial` is omitted and `steps` is empty.

**Fields**

- A `type` that no field type in the registry claims (`packages/shared/ddl-schema/src/fields/`).
- A field descriptor that is not an object.
- More than one `file` field in a single step.

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
  branches of a conditional transition.
- Any cross-step source declared `persist: false`. An unpersisted cross-step source is absent on
  every path, so this is an authoring error rather than optionality.
- The same payload key in both `fieldMapping` and `optionalFieldMapping`, checked against the
  resolved pair — either side may have been inherited from the primary.
- A `retry` outside `maxAttempts` 1–5 or `delayMs` 0–5000.
- A `fallback` entry repeating an `id` already in the chain, or declaring a `type` other than the
  primary's, or a chain longer than three entries.

**Scoring**

- A score's `min` or `max` is not an integer, or `min >= max`.
- A rule's `score` names an undeclared score, or its `add` is not an integer, or `add` is `0`.
- A step declares `scoring` while the document declares no scores at all.

**Webhooks**

- A root `webhook` without `notify`, or a `notify.path` that is empty, not trimmed, or has a segment
  that is `.`, `..`, or contains anything outside `A-Za-z0-9._~-`.
- A transition `webhook` whose `notify` is anything other than exactly `false`.

**Rejection reasons**

- A `reason` entry outside `ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`, `CHALLENGE_NOT_FOUND`,
  `CONNECTOR_REJECTED`, or the same reason listed twice.

**Loader**

- Two files declare the same `id` **and** `version`, in whichever scopes they sit.

## `DUPLICATE_STEP_NAME` · `DUPLICATE_FIELD_NAME`

Two steps share a `name`, or two fields share a name. Field names are unique across the **whole
document**, not per step — which is also why only one step per document can declare the field set an
async callback submits.

## `DUPLICATE_TRANSITION`

More than one unconditional arm within one status group. An arm counts as conditional if it carries
`when` or `reason`.

## `INVALID_TRANSITIONS`

The transitions of one step do not form a usable set.

- A non-terminal step declares no transitions at all.
- An unconditional arm is not the last arm in its status group.
- A `manual.*` arm targets its own step.
- `reason` appears on a transition whose status is not `rejected`.
- No connector on the step can reject, yet the step carries a reason-qualified `rejected` arm, or an
  unqualified `rejected` arm targeting a step other than itself.
- A connector on the step can reject, yet there is no unqualified `rejected` arm, or that arm has no
  `target`, or its target is not a step whose status is `rejected`. A refusal must always be able to
  reach a terminal rejection.

## `UNKNOWN_TARGET`

A transition's `target` names no declared step. Manual outcomes are exempt from this check at the
step level and are validated with the rest of the graph.

## `INVALID_TERMINAL_STEP`

A step whose status is `approved`, `rejected` or `invalid` declares `data` or `transitions`, or the
`initial` step is one of those statuses.

## Nothing is wrong with your file

`WorkflowRegistryService.onModuleInit` publishes the definition files, then reads back **every**
stored row and validates that too. A row published while another branch was checked out carries
that branch's properties, Ajv reports `additionalProperties`, and the container exits 1 —
`pnpm stack:up` shows `dependency failed to start` for `engine`. The `postgres-data` volume
survives `pnpm stack:down`, which is why the row is still there.

The signature is `pnpm workflow:validate` passing on every file while the engine refuses to boot.
Compare the table against the files on disk before reading any code:

```bash
docker exec tsh-onboarding-conductor-postgres-1 psql -U orchestrator -d orchestrator -c "select workflow_id, version, status, scope from workflows;"
```

A `workflow_id` in the table with no matching file under `workflows/` is the orphan. Delete those
rows specifically. Do not reach for `docker compose down -v`, which destroys the whole local
database including onboardings and audit rows that may still be wanted. Leftover `onboardings` rows
referencing a deleted workflow are harmless — startup never validates them.
