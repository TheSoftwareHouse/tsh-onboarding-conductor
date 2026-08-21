# @tsh/admin-panel

React 19 + Vite operator UI. Talks to `@tsh/engine` over HTTP only — no workspace
dependency on the engine or `@tsh/ddl-schema` — so anything the panel needs from the
engine's domain (statuses, projected fields) is declared again here, deliberately.

`docs/IMPLEMENTATION.md` §12 (repo root) covers this package's design decisions in
full — no automatic refetching, Zod-projected responses, the fixture-driven e2e
harness. Read it before touching data fetching or the e2e setup; this file only adds
what that document doesn't cover.

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
