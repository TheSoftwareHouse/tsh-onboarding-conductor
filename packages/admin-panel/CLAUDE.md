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

`docker-compose.yml`'s `admin-panel` service builds `Dockerfile` (repository-root
context) and publishes the result on `${ADMIN_PANEL_PORT:-5173}`. The image is
multi-stage: `vite build` runs in a `node:24-alpine` build stage, and only the
resulting `dist/` is copied into an unprivileged `nginxinc/nginx-unprivileged` runtime
stage — no Node, `node_modules`, source or lockfile ship in the final image. `nginx.conf`
serves it as an SPA (`try_files ... /index.html`, so a hard refresh on a client route
does not 404) and marks `/config.js` `Cache-Control: no-store`.

Configuration is read at **runtime**, not baked in at build time — the Dockerfile
declares no `ARG` and no `VITE_*` `ENV`. `write-config-js.sh` writes the container's
`VITE_*` environment variables into `/usr/share/nginx/html/config.js` as a
`window.__ENV__` object literal before nginx starts, then chains to the base image's own
`/docker-entrypoint.sh` (rather than replacing it) so its `/docker-entrypoint.d/` hooks
still run. `src/shared/config/runtime-env.ts` reads `window.__ENV__` in the browser,
falling back to the build-time
`import.meta.env` when a key is absent or empty — which is always the case under
`pnpm dev` and in Vitest, so local development and tests are unaffected. This is why a
new `VITE_*` variable needs adding in **four** places, not one: `src/vite-env.d.ts`
(the type), `docker-compose.yml`'s `admin-panel` `environment:` block,
`write-config-js.sh` (the `vars` list it writes into `config.js`), and `.env.dist`.

The Playwright suite's own dev server defaults to port **5174**, not 5173 — 5173 is
where the Compose container publishes, and the two must not contend for it.
