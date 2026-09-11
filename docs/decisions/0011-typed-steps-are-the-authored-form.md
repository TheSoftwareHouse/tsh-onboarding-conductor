# 0011. Typed steps are the authored form; the node vocabulary is retired

- **Status:** Proposed
- **Date:** 2026-09-10
- **Tags:** workflows, ddl-schema, authoring, api
- **Supersedes:** 0010
- **Superseded by:** —

## Decision

A workflow document declares `steps`, and every step names a **step type**. What 0009 introduced as
a "node graph" of "node types" is the same layer under the name the rest of the system already
uses: the authored `steps` list is the only form a document takes, each authored step compiles to
one or more runtime steps, and the runtime step shape is called the **compiled form**. There is no
`nodes` key, no "node type" and no "node" anywhere in the DDL, the engine's API, the documents or
the documentation.

What 0010 decided stands and is restated here in the new vocabulary so this record can be read on
its own: typed steps are the only authored form; the compiled form is validated as an intermediate
and never authored directly; `custom` (formerly `custom-step`) carries a compiled step verbatim so
typed steps are never less expressive; `connector-call`, step-level `scoring`, edge `webhook`
opt-outs and connector failure policies remain as 0010 describes them.

Four names change beyond the mechanical `node` → `step`:

- The generic type is `custom`, not `custom-step` — "a step of type custom-step" says step twice.
- The per-step map that renames generated sub-steps is `substeps`, since `steps` is the root list.
- A document in the compiled shape — the form workflows were authored in before step types — is an
  **untyped** document: a step without a `type`. It is refused with `INVALID_SHAPE` at that step,
  the schema's own complaint, which lands where the author adds the type; `convertUntypedSteps`
  (`pnpm workflow:compile <file> --from-untyped`) lifts it into `custom` steps, and migration
  `0020` does the same to stored rows while leaving typed rows alone.
- The admin routes are `GET /v1/admin/step-types` and `/step-types/schema`. The compile response is
  `{ definition, steps, workflow }`: `definition` stays, being the definition the engine runs, and
  `steps` reports each authored step's `compiledStepNames` and ports, named so the two lists cannot
  be confused.

In code, the unqualified names belong to the authored form — `RawWorkflowDefinition`,
`RawWorkflowStep`, `compileWorkflow`, `getWorkflowJsonSchema`, `WorkflowStepTypeDefinition`,
`registerStepType` — and the compiled intermediate is `CompiledWorkflowDefinition`,
`CompiledWorkflowStep`, `getCompiledWorkflowJsonSchema`. The engine's runtime vocabulary —
`currentStep`, step submissions, the `steps` of a stored definition's read-side projection — is
untouched: those were always the compiled steps and still are.

## Context

0010 left the DDL with two words for one thing. A document was a "node graph" while the engine, the
onboarding API, the audit log and the admin panel spoke only of steps; an authored `otp-verify`
node produced three steps, and its `steps` map renamed them. Every explanation of the layer began
by translating between the two vocabularies, and the fixtures' `-typed` twins were described as
"nodes" next to `custom-step` "nodes" that were, by their own name, steps. Once the node form
became the only authored form, the distinction the second word had marked — authored against
hand-written — no longer needed a word of its own: every document is authored the same way, and the
only remaining distinction is authored against compiled.

## Alternatives

| Option                                                                         | Why not                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep "node" for the authored unit and "step" for the compiled one              | Two words for what is, in nineteen of twenty types, one thing with one name; every reader has to learn that a node is a step, and the runtime vocabulary the API exposes would never match the document                           |
| Rename the compiled unit instead (state, stage, screen)                        | Reaches into the onboarding table, the client API, webhooks, the audit log and the admin panel — every consumer — to rename the thing they already call a step, for no gain to authors                                            |
| Keep `custom-step` as the type name                                            | "A step of type custom-step" is redundant; `custom` matches the `custom` connector type, the other place the DDL names a thing with no more specific kind                                                                         |
| Keep the per-step `steps` rename map                                           | A `steps` map inside every entry of the root `steps` list; the two would share a name and mean different things                                                                                                                   |
| Refuse an untyped document by an explicit early check, as 0010 did for `steps` | The root key is now right and only the entries are wrong; the schema already reports the first entry without a `type`, at the step the author has to fix, so a bespoke check would only restate it                                |
| Rename the compile response's `definition` to `compiled` as well               | `definition` is the definition the engine runs, and the request body is not returned under that name; renaming `stepNames` to `compiledStepNames` in the per-step report is enough to keep the compiled list and the report apart |

## Consequences

- **Every document changes key.** `nodes` → `steps`, `custom-step` → `custom`, the per-step
  `steps` map → `substeps`. Every checked-in document is converted. Nothing deployed ever held the
  interim `nodes` form, so no migration reads it; a database written while 0010 was uncommitted has
  to be recreated.
- **Untyped documents are refused where the type is missing** — at `steps[0]` for a whole untyped
  list — rather than at the root. `--from-untyped` and migration `0020` convert them.
- **The admin API moves.** `/v1/admin/node-types` → `/v1/admin/step-types` and `/node-types/schema`
  → `/step-types/schema`; the compile response's `nodes` → `steps`, its per-step `stepNames` →
  `compiledStepNames`. The workflow schema's `title` is `Onboarding workflow`; the compiled schema's
  is `Onboarding workflow (compiled)`.
- **Exported names move with the vocabulary.** `RawWorkflowDefinition` and `RawWorkflowStep` now
  denote the authored form, and code that meant the compiled one uses `CompiledWorkflow*`. The old
  `RawWorkflowNode*`, `compileNodeGraph*`, `*NodeType*` and `getNodeGraphJsonSchema` names are gone.
- **Two words remain, deliberately.** "Step" means the authored one unless a sentence says
  "compiled step"; the sub-step vocabulary (`listSubStepKeys`, `substeps`) names the extra compiled
  steps a compound type produces.
- Reversing this is a rename in the other direction: mechanical, but touching every document, route
  and exported name again.
