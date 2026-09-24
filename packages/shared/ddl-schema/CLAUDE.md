# @tsh/ddl-schema

The workflow definition language: the step types that compile an authored workflow into the
compiled form the engine runs, and the JSON Schemas, normalizer, validators and
field-type/text-format registries that hold the compiled form to the runtime contract.
Framework-free — no Nest, no HTTP — so the DDL contract can be consumed by the engine, a future
BFF, or an authoring tool without dragging in engine concerns. `docs/IMPLEMENTATION.md` §2 and
§2.1 (repo root) are the full spec of the DDL and the step types; this file only orients within
the package.

## Package-specific pitfalls

- There is no checked-in schema file. Both JSON Schemas are derived **in memory**: the compiled
  form's from `src/fields/field-type.registry.ts` and `src/formats/field-format.registry.ts`, the
  authored workflow's from those plus `src/step-types/step-type.registry.ts`. Adding a field type
  means adding one module and one registry entry — not editing a schema file, because none exists.
- Field types and formats can also be mounted at runtime via `registerFieldType` /
  `registerFieldFormat`; each compiled Ajv validator is keyed to a registry version and invalidated
  on registration, so a stale validator after a runtime registration is a version-key bug, not a
  caching bug. The workflow schema is keyed to **three** versions — step types, field types and
  formats — because a step type's config schema may reference a field descriptor or a text format.
- The engine imports this package's built `dist`, not its source — run this package's own `build`
  after a source change before relying on the engine to see it. `pnpm typecheck` does this for you:
  this package's `typecheck` script is its `build`, and `pnpm -r` runs it before any dependent's.
  Never build it from inside another package's `typecheck` — a second `rm -rf dist` under a
  running `tsc` is a "Cannot find module '@tsh/ddl-schema'" failure in whichever package loses.
- Two forms, two words. The **authored** form is typed `steps` (`RawWorkflowDefinition`,
  `RawWorkflowStep`); the **compiled** form is what they compile to and what the engine runs
  (`CompiledWorkflowDefinition`, `CompiledWorkflowStep`). Unqualified names belong to the authored
  form and `Compiled*` names the intermediate; do not reintroduce a third word for either.
- Typed steps are the **only** authored form. `validateAndNormalizeWorkflow` compiles every
  document with `compileWorkflow` and validates the result against the compiled schema and rules;
  an **untyped** document — the compiled shape written directly, a step with no `type` — fails with
  `INVALID_SHAPE` at that step. `convertUntypedSteps` is the migration path, and `custom` is the
  type that keeps typed steps no less expressive. See
  `docs/decisions/0011-typed-steps-are-the-authored-form.md`.
- Specs that state a rule of the compiled form still write untyped steps: load them through
  `src/testing/untyped-steps.helper.ts` (`validateAndNormalizeUntypedSteps`), which wraps them as
  `custom` steps and passes a typed document through untouched. `src/testing/` is excluded from the
  build.
- Adding a step type must never require an engine change; if it seems to, the type is reaching for
  something the compiled step shape cannot express and the design is wrong. A connector-bearing type
  also spreads `buildFailurePolicy` onto its declaration, so `errorHandler`, `retry` and the
  fallback chain are never lost, and a type with a compiled step to score on may name it in
  `resolveScoringStepKey` (the entry step by default; `undefined` refuses step-level `scoring`).
- A step type owns its own naming. It returns sub-step _keys_, not names, and `resolveStepNames`
  turns them into compiled step names; put naming policy there rather than in a type, or the
  `substeps` rename stops working uniformly.
- Compilation is two-phase over a document-wide contract: every `publish` is assembled before any
  step's `compile` runs. A step type that reads a neighbour's output must do it through that
  contract, never by inspecting other steps.
- A step type never sees where its ports lead. `context.targets[port]` is an opaque token the
  compiler replaces after `compile` returns — that is how conditional edges work for every type at
  once. Write the token as a transition's `target` and nothing else; a type that inspects it, or
  writes a target for a port it was not given, fails the document as a type defect.
- Every name a document invents passes `safeName`: the members of `Object.prototype` are refused.
  Do not add a lookup keyed by document names to a plain object without it; use a `Map` or
  `hasOwnProperty`, as the compiler and the registries do.
- Failures carry a `path`. Wrap a phase in `locateWorkflowFailure(path, …)` so the innermost
  location wins; never put a path into the error's `message`, which specs assert leaks nothing from
  the document. Both schemas map Ajv errors through `schema/schema-failure.ts`, and a compiled-phase
  path is restated as the authored step that produced it — a `steps[k]` path indexing compiled
  steps must never reach a caller.
- `eu-b2c-revision-equivalence.spec.ts` (in the engine) is the regression test for this whole
  layer: it pins revision 2 of the built-in route to revision 1 step by step — identical except that
  the OTP send is a step of its own — so changing how any step type compiles fails there with the
  difference named. `checked-in-workflows.spec.ts` does the same for the fixture pairs. Expect to
  see them break, and read them rather than working around them.
- A step that calls a connector declares a `connectorSlot` — the connector types it accepts — and
  reads its binding through `readConnectorBinding`, never from raw config. The slot's `extras` says
  whether the author may add `fieldMapping` and `config` keys next to what the type derives; merge
  them with `mergeDerivedWithExtras`, which refuses a key that would override a derived one.

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically when Claude reads a matching
file; listed here so they're visible without searching:

- `code-design.md`, `constants.md` — repo-wide, `packages/**/*.{ts,tsx}`
- `testing.md` — repo-wide, covers this package's co-located `*.spec.ts` files
