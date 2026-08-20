# @tsh/ddl-schema

The workflow definition language: JSON Schema, normalizer, validators, and the
field-type/text-format registries. Framework-free — no Nest, no HTTP — so the DDL
contract can be consumed by the engine, a future BFF, or an authoring tool without
dragging in engine concerns. `docs/IMPLEMENTATION.md` §2 (repo root) is the full
spec of the DDL itself; this file only orients within the package.

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

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically when Claude reads a matching
file; listed here so they're visible without searching:

- `code-design.md`, `domain-constants.md` — repo-wide, `packages/**/*.ts`
- `testing.md` — repo-wide, covers this package's co-located `*.spec.ts` files
