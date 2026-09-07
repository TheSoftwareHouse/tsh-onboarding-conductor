# @tsh/ddl-schema

The workflow definition language: JSON Schema, normalizer, validators, the
field-type/text-format registries, and the node layer that compiles an authored node
graph into steps. Framework-free — no Nest, no HTTP — so the DDL contract can be
consumed by the engine, a future BFF, or an authoring tool without dragging in engine
concerns. `docs/IMPLEMENTATION.md` §2 and §2.1 (repo root) are the full spec of the
DDL and the node layer; this file only orients within the package.

## Package-specific pitfalls

- There is no checked-in schema file. The workflow JSON Schema is derived **in
  memory** from `src/fields/field-type.registry.ts` and
  `src/formats/field-format.registry.ts`. Adding a field type means adding one module
  and one registry entry — not editing a schema file, because none exists to edit.
- Field types and formats can also be mounted at runtime via `registerFieldType` /
  `registerFieldFormat`; the compiled Ajv validator is keyed to a registry version
  and invalidated on registration, so a stale validator after a runtime registration
  is a version-key bug, not a caching bug.
- The engine imports this package's built `dist`, not its source — run this
  package's own `build` after a source change before relying on the engine to see
  it (the engine's `typecheck`/`test:e2e` scripts already do this for you).
- `src/nodes/` is an **authoring** layer, not a runtime one. A document declaring
  `nodes` is compiled to the step form by `compileNodeGraph` at the top of
  `validateAndNormalizeWorkflow`, then validated exactly as a hand-written one. Adding
  a node type must never require an engine change; if it seems to, the type is
  reaching for something the step shape cannot express and the design is wrong. See
  `docs/decisions/0009-workflow-node-types.md`.
- The node-graph schema is derived in memory too, from
  `src/nodes/node-type.registry.ts`, and is keyed to **three** registry versions —
  node types, field types and formats — because a node type's config schema may
  reference a field descriptor or a text format.
- A node type owns its own naming. It returns sub-step _keys_, not names, and
  `resolveStepNames` turns them into step names; put naming policy there rather than
  in a type, or the `steps` rename stops working uniformly.
- Compilation is two-phase over a document-wide contract: every `publish` is
  assembled before any node's `compile` runs. A node type that reads a neighbour's
  output must do it through that contract, never by inspecting other nodes.
- A node type never sees where its ports lead. `context.targets[port]` is an opaque
  token the compiler replaces after `compile` returns — that is how conditional edges
  work for every type at once. Write the token as a transition's `target` and nothing
  else; a type that inspects it, or writes a target for a port it was not given, fails
  the document as a type defect.
- Every name a document invents passes `safeName`: the members of `Object.prototype`
  are refused. Do not add a lookup keyed by document names to a plain object without
  it; use a `Map` or `hasOwnProperty`, as the compiler and the registries do.
- Failures carry a `path`. Wrap a phase in `locateWorkflowFailure(path, …)` so the
  innermost location wins; never put a path into the error's `message`, which specs
  assert leaks nothing from the document.
- `eu-b2c-node-graph-equivalence.spec.ts` (in the engine) is the regression test for this whole layer: it asserts the two built-in revisions normalize identically, so
  changing how any node type compiles fails there with the difference named. Expect to
  see it break, and read it rather than working around it.

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically when Claude reads a matching
file; listed here so they're visible without searching:

- `code-design.md`, `domain-constants.md` — repo-wide, `packages/**/*.ts`
- `testing.md` — repo-wide, covers this package's co-located `*.spec.ts` files
