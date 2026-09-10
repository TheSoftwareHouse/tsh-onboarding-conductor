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

## Styling

Tailwind 4, configured entirely in `src/app/tailwind.css` — there is no config file. That file
also fixes the layer order (`theme, base, vendor, legacy, components, utilities`) so the remaining
BEM in `styles.css` and the utilities can coexist: a utility beats a legacy rule, and `vendor` sits
below `legacy` so the `.workflow-canvas` overrides win over React Flow's stylesheet.

- **Only tokens declared in that file's `@theme`.** Tailwind's default palette is switched off
  (`--color-*: initial`), so an off-system colour does not resolve at all. Prefer the role tokens
  (`text-fg-3`, `border-border-rule`, `bg-bg-subtle`) over the `tsh-*` primitives they point at.
- **Variants go through `tv` from `@/shared/lib/tv`, conditionals through `cn` from
  `@/shared/lib/cn`** — both bound to this project's merge config. Never import `tailwind-variants`'
  own `tv`, which knows only Tailwind's stock scales.
- ESLint runs `better-tailwindcss` with canonical-classes, class-order, no-duplicate and
  no-conflicting as errors. `no-unknown-classes` stays off only until the last BEM class is gone.
- **Legacy BEM is being retired page by page, not all at once.** The onboarding details page,
  Connectors and the sign-in screen still use it; the calendar inside `DateTimePickerField`
  (`.calendar*`, `.chip*`) is the largest block left. Deleting a rule from `styles.css` needs a grep
  first — several rules style by descendant selector (`.filter-field input`), so a class can look
  unused while still supplying a control's entire appearance.

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

There are two ways to see a panel change without rebuilding the engine image, and they differ in
which origin serves it. `pnpm dev` is the fast one — Vite on 5173, real HMR — but it is a separate
origin, so it needs `ADMIN_PANEL_ORIGIN` and `VITE_ENGINE_API_BASE_URL` to agree or the engine's
CORS check rejects every request. `pnpm stack:panel-dev:up` keeps the panel on the engine's own
origin instead: the `docker-compose.panel-dev.yml` overlay mounts the host's `dist` into the
container and sets `ADMIN_PANEL_DIST_DIR` to it, and because the static handler reads from disk per
request, a `pnpm panel:watch` rebuild is served on the next refresh with no restart. Use the second
when what is being tested is same-origin behaviour — `/config.js`, the SPA fallback, an auth
redirect — since those are exactly the paths `pnpm dev` does not exercise.

The Playwright suite's own dev server defaults to port **5174**, not 5173, so it never contends
with a `pnpm dev` panel on 5173.
