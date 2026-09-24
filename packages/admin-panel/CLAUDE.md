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

`docs/IMPLEMENTATION.md` §12 (repo root) covers this package's design decisions in full — no
automatic refetching, Zod-projected responses, the fixture-driven e2e harness, the two-layer
search-param validation split (nuqs parsers at the URL boundary; plain TypeScript for what no
single parser can judge — the Logs `occurredFrom <= occurredTo` window, and a per-control
predicate in Onboardings, which has no cross-field rule at all — with zod playing no part in
either filter path). Read it before touching data fetching, filter state or the e2e setup; this
file only adds what that document doesn't cover.

Four call sites carrying state in the URL — Onboardings, Logs, Connectors' `?type=` nav, and the
onboarding details page's `?tab=` — read and write it through `nuqs`'s `useQueryStates`, never
`useSearchParams` directly — see `docs/decisions/0018-nuqs-for-admin-panel-search-params.md`. All
four pass `shallow: false`, required of any future call too if anything reads router state after a
commit: without it nuqs only writes `history.replaceState`, react-router never sees it, and
`useLocation()` — which `AdminLayout`'s remembered per-section search reads — goes stale. A link
written **into** another route's committed criteria goes through a serializer too, never a built-up
string: `src/lib/audit-search-params.ts` declares `resourceType`/`resourceId` — and the
`onboarding` resource-type value itself — once for both the Logs route and the details page's "See
in Logs" link, which is how such a link stays typed where a route may not import another route's
utils. Anything else two routes address the trail by goes to the same shared tier rather than being
restated: the endpoint path is `ADMIN_AUDIT_ENDPOINT` in `src/api/audit/audit-events.ts` (see Data
fetching, below); `src/lib/audit-metadata.ts` formats a metadata value and `src/lib/audit-actions.ts`
flags a failure action the same way wherever the trail is shown.
Leave `throttleMs` at its default. In `src/app/App.tsx`, `NuqsAdapter` (from
`nuqs/adapters/react-router/v8`) sits **inside** `BrowserRouter`, wrapping `Routes`, not inside
`AppProviders`, which renders above the router and has no router context to give an adapter reading
react-router's own hooks; any future router-context provider belongs below `BrowserRouter` for the
same reason.

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically on a matching file; listed here:

- `code-design.md`, `constants.md` — repo-wide, `packages/**/*.{ts,tsx}`, so they
  reach this package's components and not only its plain `.ts`
- `testing.md` — repo-wide test conventions; this package's own tests are Vitest
  (`*.spec.ts`/`*.spec.tsx` under `src/`) and Playwright (`e2e/*.spec.ts`)

There is no admin-panel-specific rule file yet — React/Vite conventions distinct from the
repo-wide ones belong here, not in a new central rule.

## Styling

Tailwind 4, configured entirely in `src/app/tailwind.css` — there is no config file. That file
also fixes the layer order (`theme, base, vendor, legacy, components, utilities`) so the remaining
BEM in `styles.css` and the utilities can coexist: a utility beats a legacy rule, and `vendor` sits
below `legacy` and `utilities` so a Tailwind override still wins over React Flow's own stylesheet
(`WorkflowGraph`'s node and canvas styling, now Tailwind itself, is the current example).

- **Only tokens declared in that file's `@theme`, and registered twice.** Tailwind's default
  palette is off (`--color-*: initial`), so an off-system colour never resolves — prefer role
  tokens (`text-fg-3`, `border-border-rule`, `bg-bg-subtle`) over the `tsh-*` primitives. A custom
  scale also needs adding to `src/lib/tailwind-merge-config.ts`, or `tailwind-merge` silently
  fails to judge conflicts — `cn('w-filter-nav', 'w-64')` keeps _both_ classes until it's
  registered, and `pnpm lint` won't catch it; probe against a registered scale (`h-header`).
- **Variants go through `tv` from `@/lib/tv`, conditionals through `cn` from `@/lib/cn`** — both
  bound to this project's merge config. Never `tailwind-variants`' own `tv`, which knows only
  Tailwind's stock scales.
- **Text takes its style from `Typography`, not from `text-*` classes on a raw tag.** Its variant
  picks the element too, and it is polymorphic, so `as="label"` carries `htmlFor`. Note `caps-*`
  bake in `uppercase` while `meta` is the same 12px size _without_ capitals — the design uses that
  more often than not, so reach for `meta` rather than undoing a variant with `normal-case`.
- ESLint runs `better-tailwindcss` with canonical-classes, class-order, no-duplicate and
  no-conflicting as errors. `no-unknown-classes` stays off only until the last BEM class is gone.
- **Legacy BEM is being retired page by page, not all at once.** The sign-in screen (`.page`,
  `.auth-*`, `.field-error`) is the only area still carrying it, above the `:root` custom
  properties and base element rules in `styles.css`. Everything else is migrated, including
  `WorkflowGraph`, which stays in the tree unrendered for a future workflow-definition page.
- **Deleting a rule from `styles.css` needs more than a grep for its class.** Some rules style by
  descendant selector or assemble a state modifier at runtime rather than matching their class
  name verbatim — `.metadata-list dd` and `` `graph-node--${state}` `` both did, before the
  details page's rules were retired — so a class can look unused while still supplying a control's
  entire appearance. Check for that pattern before trusting a grep.

## Forms

`react-hook-form` 7.88.0 is the panel's form library (ADR 0019): one `useForm` per `ConnectorCard`
isolates drafts structurally. No `zod` resolver. `isRequired` renders the badge and `aria-required`;
`rules` enforce it only for `source === 'unset'`, since a stored box is always empty — the engine
alone judges the merged result and pairings. `connector-settings-form.ts` owns the trim-compare and
asymmetric deletion rule; filter panels stay outside RHF (ADR 0018's URL-committed criteria).

## Data fetching

`src/api/<domain>/` holds every engine read and write — `audit`, `onboardings`, `workflows`,
`connectors`. Scope: queries, mutations, response/request types and contract schemas, nothing else;
display labels, tones and UI predicates stay in the route. A domain is one or more fetch/write
modules, one per engine resource, plus exactly one `<domain>Queries` factory, never merged: keys are
hierarchical (`all()` → `['audit']` → `lists()` → `list(filters)`), `queryFn` closes over its
argument rather than re-reading it off `queryKey`, and `queryOptions` takes `TError` explicitly or
the typed error degrades to `Error`. Mutations are plain functions from a route's `useMutation`,
since 5.74.0 exports no `mutationOptions`; a write refreshes by invalidating, never `removeQueries`.
No key is built outside this tier, which must never import from `src/app/` (ADR 0022 says why).

## Structure

ADR 0017 (`Accepted`) states these rules in full and why; this is how they land in this package.

Every route lives under `src/app/<route>/`, named after its URL segment (`onboardings`,
`audit`, `connectors`), owning whatever only it uses — `components/`, `hooks/`, `types/`,
`utils/`, `constants/`, `stores/` (never engine calls — those are `src/api/`). A nested route
nests as a folder: `/onboardings/:onboardingId` is `src/app/onboardings/details/`, a **dynamic**
segment named for what the route shows — `details`, not `[onboardingId]`.

Six tiers sit outside the routes: `src/components/ui/` for shared components; `src/services/`
for shared logic wrapping an external boundary — `auth/` wraps MSAL, `api/` wraps axios and the
engine; `src/api/<domain>/` for the engine's reads and writes and their query definitions (Data
fetching, above); and `src/config/`, `src/constants/`, `src/lib/` for shared logic that is not a
service. `src/app/providers/` and `src/app/layout/` are the app shell, not a route. The shell
mounts no header: **every page renders its own `PageHeader`**, a section page from the
`eyebrow`/`title` its `ADMIN_SECTIONS` entry is rendered with, so the actions and status that
band carries sit in the page that owns them.

The four rules, applied in order:

1. **Consumers.** One route → that route. Two or more → shared.
2. **Intent overrides consumers, for components only.** A reusable primitive stays in
   `components/ui/` on one consumer (`SideNav`); a component built for one parent nests under
   it even if reusable (`ConnectorSettingField` under `ConnectorCard`, `SignInPage` under
   `AuthGate`). Revising intent moves the component.
3. **One file stays flat; more than one gets a folder**, named after the component
   (`components/ui/TshSignet.tsx` flat; `components/ui/Button/` a folder). No exemption for
   `src/components/ui/` or for grouping folders. The one exception is a **route entry file** —
   a route's page sits directly in its route folder (`app/audit/AuditPage.tsx` beside its
   spec), because that folder is already the page's; likewise the `app/layout/` shells.
4. **A grouping folder names a family** — `components/ui/filters/` holds `FilterPanel`, its
   controls and the `FilterField` wrapper. Grouping does not override rule 3.

Nesting encodes the render chain: `AuditResults/AuditTable/AuditTableRow/AuditActorCell/` is a
real path, each folder the sole consumer of the one below, so a component's blast radius is
visible from its path.

No barrel files anywhere — no `index.ts` under `src/`, and none should be added.

Imports follow the same boundary: anything outside your own folder tree uses the `@/` alias;
anything inside it stays relative, however long the chain (`AuditActorCell.tsx` reaching
`'../../../../../utils/describe-audit-events'` is legal and expected). `@/app/…` must never
appear **in a route's own files** — aliasing into your own route hard-codes its folder name
into its own files. Code outside the routes, such as `e2e/`, legitimately uses it. Within
`src/components/ui/` and `src/services/`, a sibling import may use either form; both are
correct, so don't churn them.

Auth is not a route: `AuthProvider` and `AuthGate` are two halves of one mechanism — both read
`isAuthEnabled()`, both pass children through when auth is off, and the provider must wrap the
gate — so they sit together under `src/app/providers/AuthProvider/`, with `SignInPage` nested
in the gate that is its only renderer. The three plain auth modules (`auth-config.ts`,
`msal-instance.ts`, `engine-access-token.ts`) are non-React and live in `src/services/auth/`.

## Built, served and configured

This package produces a static build and nothing else — no image, no Dockerfile, no Compose
service of its own. `packages/engine/Dockerfile` runs `vite build` in its `build` stage alongside
the engine's own build and carries the resulting `dist/` into the runtime stage, and the engine
serves it from its own origin: the API answers under `/v1`, the panel at every other path.
`pnpm stack:up` therefore publishes both on `${ENGINE_PORT:-3000}`. See
`packages/engine/src/admin-panel/` for the serving side and
`docs/decisions/0004-admin-panel-served-by-the-engine.md` for why.

Configuration is read at **runtime**, not baked in at build time — unchanged from when the panel
had its own image, only the writer moved. The engine renders `/config.js` from its own
`ConfigService` on every request, as a `window.__ENV__` object literal; `src/config/runtime-env.ts`
reads it in the browser, falling back to build-time `import.meta.env` when a key is absent or
empty — always true under `pnpm dev` and in Vitest, so local dev and tests are unaffected.
`dist/config.js` (from `public/config.js`) stays the `pnpm dev` placeholder; the engine answers
`/config.js` ahead of the static handler, so the placeholder is never served from a container.

`VITE_ENGINE_API_BASE_URL`'s default is worth knowing: unset means the panel calls the origin it
was served from, correct for every deployment running the engine image. Set it only to point a
dev, or separately hosted, panel at a different engine.

A new `VITE_*` variable needs adding in **four** places: `src/vite-env.d.ts` (the type),
`docker-compose.yml`'s `engine` `environment:` block, `ADMIN_PANEL_RUNTIME_CONFIG_KEYS` in
`packages/engine/src/admin-panel/admin-panel-runtime-config.ts`, and `.env.dist`. Missing one
fails silently — the variable falls back to whichever source still has it.

There are two ways to see a panel change without rebuilding the engine image, differing in which
origin serves it. `pnpm dev` is fastest — Vite on 5173, real HMR — but a separate origin, so
`ADMIN_PANEL_ORIGIN` and `VITE_ENGINE_API_BASE_URL` must agree or the engine's CORS check rejects
every request. `pnpm stack:panel-dev:up` keeps the panel on the engine's own origin instead: the
`docker-compose.panel-dev.yml` overlay mounts the host's `dist` into the container and sets
`ADMIN_PANEL_DIST_DIR` to it, so — since the static handler reads from disk per request — a
`pnpm panel:watch` rebuild is served on the next refresh with no restart. Use the second for
same-origin behaviour — `/config.js`, the SPA fallback, an auth redirect — since `pnpm dev` does
not exercise those.

The Playwright suite's own dev server defaults to port **5174**, not 5173, so it never contends
with a `pnpm dev` panel on 5173.
