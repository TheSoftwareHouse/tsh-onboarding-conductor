# @tsh/admin-panel

React 19 + Vite operator UI. Talks to `@tsh/engine` over HTTP only — no workspace
dependency on the engine or `@tsh/ddl-schema` — so anything the panel needs from the
engine's domain (statuses, projected fields) is declared again here, deliberately.

`docs/IMPLEMENTATION.md` §12 (repo root) covers this package's design decisions in
full; the highlights worth not missing:

- No automatic refetching — data changes only on explicit Apply / Reload / Reset.
- API responses are Zod-validated and explicitly projected, so an engine field never
  reaches the browser just because the engine started returning it.
- `e2e/run-direct-engine-playwright.cjs` boots a fixture engine and points the panel
  at it before running Playwright — the panel's e2e does not need the Docker stack.

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically when Claude reads a matching
file; listed here so they're visible without searching:

- `code-design.md`, `domain-constants.md` — repo-wide, `packages/**/*.ts`
- `testing.md` — repo-wide test conventions; this package's own tests are Vitest
  (`*.spec.ts`/`*.spec.tsx` under `src/`) and Playwright (`e2e/*.spec.ts`)

There is no admin-panel-specific rule file yet — React/Vite conventions distinct from
the repo-wide ones belong here as this package grows, not in a new central rule.

## Structure

`src/features/<feature>/` are vertical slices (`api`, `components`, `hooks`, `types`,
`constants`, `utils`); `src/shared/` holds cross-feature code; `src/app/` wires pages
and routing.
