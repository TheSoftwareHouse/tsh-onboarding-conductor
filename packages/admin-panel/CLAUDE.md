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

- `code-design.md`, `constants.md` — repo-wide, `packages/**/*.{ts,tsx}`, so they
  reach this package's components and not only its plain `.ts`
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
- **Variants go through `tv` from `@/lib/tv`, conditionals through `cn` from
  `@/lib/cn`** — both bound to this project's merge config. Never import `tailwind-variants`'
  own `tv`, which knows only Tailwind's stock scales.
- ESLint runs `better-tailwindcss` with canonical-classes, class-order, no-duplicate and
  no-conflicting as errors. `no-unknown-classes` stays off only until the last BEM class is gone.
- **Legacy BEM is being retired page by page, not all at once.** Three areas still carry it: the
  onboarding details page (`.detail-*`, `.metadata-list`, `.link`, `.flow*`, `.graph-node*`,
  `.workflow-canvas`), Connectors (`.connector-*`, `.secret-input*`, `.chip*`) and the sign-in
  screen (`.page`, `.auth-*`), with `.field-error` shared by the last two — plus the global base
  above them, which also holds the custom properties `workflow-graph-layout.ts` reads at runtime.
  The lists, the filter panel and the calendar are done. Note that legacy `.chip` (Connectors) and
  the Tailwind `Chip` component are unrelated things sharing a name.
- **Deleting a rule from `styles.css` needs more than a grep for its class.** Some rules style by
  descendant selector (`.metadata-list dd`, `.workflow-canvas .react-flow__handle`), and the state
  modifiers are assembled at runtime (`` `flow__node--${tone}` ``, `` `graph-node--${state}` ``), so a
  class can look unused while supplying a control's entire appearance.

## Structure

Every route lives under `src/app/<route>/`, named after its URL segment (`onboardings`,
`audit`, `connectors`), owning whatever only it uses — `components/`, `hooks/`, `api/`,
`types/`, `utils/`, `constants/`, `stores/`. A nested route nests as a folder:
`/onboardings/:onboardingId` is `src/app/onboardings/details/`. A **dynamic** segment has
no name to mirror, so it is named for what the route shows — `details`, not
`[onboardingId]`. The folder is named after the URL wherever the URL supplies a name. Four tiers sit
outside the routes: `src/components/ui/` for shared components; `src/services/` for shared logic
that wraps an external boundary — `auth/` wraps MSAL, `api/` wraps axios and the engine, and
`services/api/http-client.ts` reaching `services/auth/engine-access-token.ts` is the one place two
services genuinely depend on each other; and `src/config/`, `src/constants/` and `src/lib/`,
directly under `src/`, for shared logic that is not a service. `src/app/providers/` and
`src/app/layout/` are the app shell, not a route.

Four rules decide where a module goes, applied in order:

1. **Consumers.** One route uses it → it lives in that route. Two or more → shared: `src/lib/`,
   `src/config/` or `src/constants/` for logic, `src/services/` only when it wraps an external
   boundary, `src/components/ui/` for components.
2. **Intent overrides consumers, for components only.** A component built as a reusable
   primitive stays in `components/ui/` even with a single consumer today (`PageHeader`,
   `SideNav`). A component built for one specific parent nests inside that parent's
   folder even where it could theoretically be reused (`SecretInput` under
   `ConnectorSettingField`).
3. **One file stays flat; more than one gets a folder.** Count the files belonging to the
   component. Just the `.tsx` → it stays a flat file (`components/ui/PageBody.tsx`,
   `app/onboardings/components/OnboardingFilters.tsx`). A spec beside it, or children
   nesting under it, → it gets a folder named after it, holding all of them
   (`components/ui/Button/`, `app/layout/SessionBar/`). This holds in every tier — there is
   no `src/components/ui/` exemption and no grouping-folder exemption.

   The one thing outside the count is a **route entry file**: a route's page lives directly
   in its route folder (`app/audit/AuditPage.tsx` beside `AuditPage.spec.tsx`), because the
   route folder is already that page's folder. The same goes for the shells in
   `app/layout/`. Nesting them would push a page below its own route's `components/`.

4. **A grouping folder names a family.** Several components that are variants or parts of
   one concept sit under a shared folder — `components/ui/filters/` holds `FilterPanel`,
   the five controls a page renders into it, and the `FilterField` wrapper whose
   `filterControl` variant and `FilterControlProps` interface they share and nothing
   outside the folder imports. The folder groups them; it does not change rule 3, so each
   member with a spec still has its own folder inside it and `FilterField.tsx` stays flat
   as a lone file.

Nesting encodes the render chain: `AuditResults/AuditTable/AuditTableRow/AuditActorCell/`
is a real path, each folder the sole consumer of the one below it, so a component's
blast radius is visible from its path.

No barrel files anywhere — no `index.ts` under `src/`, and none should be added.
Imports are full-path.

Import form follows the same boundary: anything outside your own folder tree — another
route, `src/services/`, `src/config/`, `src/constants/`, `src/lib/`, `src/components/` —
uses the `@/` alias; anything inside it stays relative, however long the chain
(`'../../../../../types/audit-event'` is legal and expected). `@/app/…` must never appear
**in a route's own files** — aliasing into your own route hard-codes its folder name into
its own files. Code outside the routes, such as `e2e/`, legitimately uses the `@/app/…`
alias to reach into one. This holds with no exceptions inside a route: `src/components/ui/`
reaches `src/lib/` by alias too.

Inside `src/components/ui/`, a component may import a sibling, and either form is
accepted — `filters/FilterPanel/FilterPanel.tsx` reaches `../../Button/Button` while
`filters/DateTimePickerField/DateTimePickerField.tsx` reaches the same component as
`@/components/ui/Button/Button`. Both are correct; normalizing one to the other buys
nothing, so don't churn them. The same latitude covers `src/services/`, where
`http-client.ts` imports `../auth/engine-access-token`.

Auth is not a route: `AuthProvider` and `AuthGate` are two halves of one mechanism —
both read `isAuthEnabled()`, both pass children through when auth is off, and the
provider must wrap the gate — so they sit together under
`src/app/providers/AuthProvider/`, with `SignInPage` nested in the gate that is its
only renderer. The three plain auth modules (`auth-config.ts`, `msal-instance.ts`,
`engine-access-token.ts`) are non-React and live in `src/services/auth/` — one of the
two modules under `src/services/`, alongside `src/services/api/`, because each wraps
an external boundary (MSAL; axios and the engine). A module that does not wrap an
external boundary belongs in `src/config/`, `src/constants/` or `src/lib/` instead.

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
object literal; `src/config/runtime-env.ts` reads it in the browser, falling back to the
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
