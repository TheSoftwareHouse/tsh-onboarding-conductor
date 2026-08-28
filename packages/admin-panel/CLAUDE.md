# @tsh/admin-panel

React 19 + Vite operator UI. Talks to `@tsh/engine` over HTTP only and has no workspace
dependency on the engine, so anything the panel needs from the engine's domain
(statuses, projected fields) is declared again here, deliberately.

The one exception is `@tsh/ddl-schema/workflow-contract`, imported for the connector
capability vocabulary (`CONNECTOR_TYPES`). That subpath is plain constants and types with
no runtime dependencies of its own, so it pulls nothing else — notably not `ajv` — into
the browser bundle, which importing the package root would. Import that subpath only;
never `@tsh/ddl-schema` itself. Note that the onboarding statuses still keep their own
copy (see `docs/IMPLEMENTATION.md` §12), so the two contracts are handled differently.

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

## Built, served and configured

This package produces a static build and nothing else — it has no image, no Dockerfile and no
Compose service of its own. `packages/engine/Dockerfile` runs `vite build` in its `build` stage
alongside the engine's own build and carries the resulting `dist/` into the runtime stage, and
the engine serves it from its own origin: the API answers under `/v1`, the panel answers at
every other path.
`pnpm stack:up` therefore publishes both on `${ENGINE_PORT:-3000}`. See
`packages/engine/src/admin-panel/` for the serving side and
`docs/decisions/0004-admin-panel-served-by-the-engine.md` for why.

Configuration is read at **runtime**, not baked in at build time, and that mechanism is
unchanged from when the panel had its own image — only the thing writing it moved. The engine
renders `/config.js` from its own `ConfigService` on every request, as a `window.__ENV__`
object literal; `src/shared/config/runtime-env.ts` reads it in the browser, falling back to the
build-time `import.meta.env` when a key is absent or empty — which is always the case under
`pnpm dev` and in Vitest, so local development and tests are unaffected.
`dist/config.js` (from `public/config.js`) stays as the `pnpm dev` placeholder; the engine
answers `/config.js` ahead of the static handler, so the placeholder is never served from a
container.

`VITE_ENGINE_API_BASE_URL` is the one value with a default worth knowing: unset means the panel
calls the origin it was served from, which is correct for every deployment that runs the engine
image. Set it only to point a dev panel — or a separately hosted one — at a different engine.

A new `VITE_*` variable needs adding in **four** places, not one: `src/vite-env.d.ts` (the
type), `docker-compose.yml`'s `engine` `environment:` block,
`ADMIN_PANEL_RUNTIME_CONFIG_KEYS` in
`packages/engine/src/admin-panel/admin-panel-runtime-config.ts`, and `.env.dist`. Missing one
fails silently — the variable falls back to whichever source still has it.

The Playwright suite's own dev server defaults to port **5174**, not 5173, so it never contends
with a `pnpm dev` panel on 5173.
