# @tsh/admin-panel

React 19 + Vite operator UI. Talks to `@tsh/engine` over HTTP only and has no workspace
dependency on the engine, so anything the panel needs from the engine's domain (statuses,
projected fields) is declared again here, deliberately.

The exception is `@tsh/ddl-schema`'s browser-safe subpaths: `workflow-contract`, `step-types` and
`workflow-schema`. They carry no `ajv`, which the root and every other path would pull into the
bundle. ESLint (`no-restricted-imports`) forbids `@tsh/engine`, the root and any other deep path
(ADR 0051).

`docs/IMPLEMENTATION.md` §12 (repo root) covers this package's design decisions in full — no
automatic refetching, Zod-projected responses, the fixture-driven e2e harness, search-param
validation. Read it before touching data fetching, filter state or the e2e setup; this file only
adds what that document doesn't cover.

## Conventions that apply here

Rules in `.claude/rules/` (repo root) load automatically on a matching file:

- `code-design.md`, `constants.md` — repo-wide, `packages/**/*.{ts,tsx}`, so they reach this
  package's components too
- `testing.md` — repo-wide test conventions; tests here are Vitest (`*.spec.ts`/`*.spec.tsx`
  under `src/`) and Playwright (`e2e/*.spec.ts`)

There is no admin-panel-specific rule file — React/Vite conventions belong here, not in a new
central rule.

## URL state

State in the URL is read and written through `nuqs`'s `useQueryStates`, never `useSearchParams`
(ADR 0018). Every call passes `shallow: false`: without it nuqs only writes
`history.replaceState`, react-router never sees it, and `AdminLayout`'s remembered per-section
search goes stale. Leave `throttleMs` at its default.

A link into another route's criteria goes through a serializer, never a built-up string —
`src/lib/audit-search-params.ts` serves both the Logs route and the details page's "See in Logs"
link, since a route may not import another route's utils. Anything else two routes address the
audit trail by lives in a shared tier too, never restated: the endpoint is `ADMIN_AUDIT_ENDPOINT`
in `src/api/audit/audit-events.ts`, `src/lib/audit-metadata.ts` formats a metadata value, and
`src/lib/audit-actions.ts` flags a failure action.

The router is a data router (`createBrowserRouter`, ADR 0050), so a page can call `useBlocker`.
`NuqsAdapter` is the root route's element in `src/app/App.tsx`, not in `AppProviders`, which
renders above the router; any future router-context provider goes there too. A spec rendering a
page that calls `useBlocker` builds a `createBrowserRouter` too, and disposes it in `afterEach`.

## Graph editor

The draft editor's Authored graph tab edits the draft's authored document on a canvas
(`src/app/workflows/details/components/AuthoredCanvas/`, ADR 0051).

- The document is the single source of truth. `AuthoredCanvas` keeps no copy: every edit hands the
  whole next document to `onChange`, and undo and redo step through whole-text versions.
- Inspector forms (`SchemaForm`) are generated from each step type's JSON Schema and write straight
  into the document, outside react-hook-form. Do not add RHF state beside it.
- A step's position lives in its `meta.position`. Once one step has it, every canvas edit writes it
  for all steps (`pinPositions`), and Auto-arrange rewrites them all.
- Ports and stored fields come from `@tsh/ddl-schema/step-types`, never from a panel-side copy of the
  compile.
- Anything a condition or setting can name (stored fields, declared scores) comes from
  `projectDocument`'s `contents`, read deep in the forms through `useWorkflowContents()`. Panels one level
  under the canvas take the projection as props instead.
- Inspector copy and controls follow one set of rules. ALL CAPS (`caps-tiny`) only for section and panel
  titles and the AND / OR between conditions; labels inside a section are Capitalized. Add, delete and clear go through
  `AuthoredCanvas/EntryActions.tsx`: `AddButton` (`+ Add <thing>`), `DeleteButton` (red trash, removes a list
  entry) and `ClearButton` (×, unsets an optional setting). Three containers, one meaning each: a list
  entry (added, deleted, reordered) is an `EntryCard` — white, bordered, its `EntryTitle` row set off by a
  hairline (a short card such as a scoring rule or an agreement has no title row, and never a numbered one); a group (a fixed named set of settings, such as Validation or a nested object) is a `FieldRow`
  with `group`, drawn on a `bg-subtle` panel when outermost and indented by a left rule inside another group; a condition keeps
  its yellow rule. An empty value reads "Not set". Four text tiers inside a
  section: section title (`caps-tiny`), card title (`EntryTitle`, mono), group title (14px sans), field label (`meta`, medium, `fg-1`), and
  everything secondary — hints, counts, "Go to", "Not set" — plain `meta`.

## Styling

Tailwind 4, configured entirely in `src/app/tailwind.css` — there is no config file. That file
also fixes the layer order (`theme, base, vendor, components, utilities`): `vendor` sits below
`components` and `utilities` so a Tailwind override still wins over React Flow's own stylesheet
(`WorkflowGraph`'s node and canvas styling, now Tailwind itself, is the current example; it lives in `src/app/workflows/details/`).

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
- ESLint runs `better-tailwindcss` with canonical-classes, class-order, no-duplicate,
  no-conflicting and no-unknown-classes, all as errors.
- **Base element rules — focus ring, disabled controls, body font/colour/background, `#app`
  flex, `color-scheme` — live in `tailwind.css`'s `@layer base`**, referencing
  `@theme` tokens, never hex literals. `WorkflowGraph` lives in `src/app/workflows/details/`; every rendered surface, including the sign-in screen, is Tailwind.

## Toasts

`@base-ui/react` (ADR 0031) is the panel's headless primitive library, `Toast` first. A mutation
reports its outcome only through `showSuccessToast` / `showErrorToast` / `showProgressToast`
(`src/components/ui/Toast/toast-manager.ts`), never inline status text. Loading, fetch errors and
field-level validation are not toasts.

## Forms

`react-hook-form` is the panel's form library (ADR 0019); filter panels stay outside it.

- **Connector cards:** one `useForm` per `ConnectorCard` and no `zod` resolver, because the engine
  alone judges connector settings. `rules` enforce `isRequired` only for `source === 'unset'`,
  since a stored box is always empty. `connector-settings-form.ts` owns the trim-compare and
  deletion rule.
- **A form that checks input client-side** states its rules once as a `zod` schema through
  `zodResolver`, and submits the schema's output (ADR 0035; `app/workflows/utils/new-draft-schema.ts`).

## Data fetching

`src/api/<domain>/` holds every engine read and write: queries, mutations, request/response types
and contract schemas, nothing else — display labels, tones and UI predicates stay in the route.
A domain is one or more fetch/write modules plus exactly one `<domain>Queries` factory:

- Keys are hierarchical (`all()` → `lists()` → `list(filters)`); no key is built outside this tier.
- `queryFn` closes over its argument rather than re-reading `queryKey`.
- Failures are `ApiError` (`src/services/api/api-error.ts`), registered as `defaultError`; factories take no generics; detail properties are read through the domain's reader.
- The one `Register` augmentation is `src/react-query-register.ts`. A new meta field is a type-alias section in `AppMutationMeta` plus a `MutationCache` handler.
- A write is a factory in `<domain>-mutations.ts` built with `@/services/query-client/mutation-options`
  and spread into the route's `useMutation` (ADR 0036). Its success invalidations go in its `meta`
  (`awaits` / `invalidates`); a hook spec asserting them builds its client with `createQueryClient()`.
- Invalidation that reads the cache and `removeQueries` stay in the hook; `removeQueries` only what
  the write deleted, once the editor unmounts (`useRemoveVersionOnUnmount`), never while it is
  still mounted.
- This tier never imports from `src/app/` (ADR 0022).

## Structure

ADR 0017 states these rules in full; this is how they land here.

Every route lives under `src/app/<route>/`, named after its URL segment, owning whatever only it
uses — `components/`, `hooks/`, `types/`, `utils/`, `constants/`, `stores/` (never engine calls).
A nested route nests as a folder named for what it shows: `/onboardings/:onboardingId` is
`src/app/onboardings/details/`.

Outside the routes: `src/components/ui/` (shared components), `src/services/` (external
boundaries — `auth/` wraps MSAL, `api/` wraps axios), `src/api/<domain>/`, and `src/config/`,
`src/constants/`, `src/lib/`. `src/app/providers/` and `src/app/layout/` are the app shell. The
shell mounts no header: **every page renders its own `PageHeader`**.

The four rules, applied in order:

1. **Consumers.** One route → that route. Two or more → shared.
2. **Intent overrides consumers, for components only.** A reusable primitive stays in
   `components/ui/` on one consumer (`SideNav`); a component built for one parent nests under it
   (`ConnectorSettingField` under `ConnectorCard`).
3. **One file stays flat; more than one gets a folder** named after the component. The exception
   is a route entry file, which sits directly in its route folder (`app/audit/AuditPage.tsx`).
4. **A grouping folder names a family** (`components/ui/filters/`). Grouping does not override
   rule 3.

Nesting encodes the render chain, so a component's blast radius is visible from its path.

No barrel files — no `index.ts` under `src/`.

Imports: outside your own folder tree use `@/`; inside it stay relative, however long the chain.
`@/app/…` never appears in a route's own files (`e2e/` may use it). Within `src/components/ui/`
and `src/services/`, a sibling import may use either form — don't churn them.

Auth is not a route: `AuthProvider` and `AuthGate` are two halves of one mechanism (the provider
must wrap the gate), so both sit under `src/app/providers/AuthProvider/`, with `SignInPage`
nested in the gate. The non-React auth modules live in `src/services/auth/`.

## Built, served and configured

This package produces a static build and nothing else. `packages/engine/Dockerfile` runs
`vite build` and the engine serves `dist/` from its own origin: the API under `/v1`, the panel at
every other path, both on `${ENGINE_PORT:-3000}` (ADR 0004).

Configuration is read at **runtime**. The engine renders `/config.js` as `window.__ENV__` on every
request; `src/config/runtime-env.ts` reads it, falling back to `import.meta.env` when a key is
absent — always the case under `pnpm dev` and Vitest. Leaving `VITE_ENGINE_API_BASE_URL` unset
means the panel calls the origin that served it.

A new `VITE_*` variable needs adding in **four** places, or it silently falls back to whichever
source still has it: `src/vite-env.d.ts`, `docker-compose.yml`'s `engine` `environment:`,
`ADMIN_PANEL_RUNTIME_CONFIG_KEYS` in `packages/engine/src/admin-panel/admin-panel-runtime-config.ts`,
and `.env.dist`.

Two ways to see a change without rebuilding the image:

- `pnpm dev` — Vite on 5173 with HMR, but a separate origin, so `ADMIN_PANEL_ORIGIN` and
  `VITE_ENGINE_API_BASE_URL` must agree or CORS rejects every request.
- `pnpm stack:panel-dev:up` + `pnpm panel:watch` — the host's `dist` served from the engine's
  origin, refreshed per request. Use it for `/config.js`, the SPA fallback or an auth redirect,
  which `pnpm dev` does not exercise.

The Playwright suite's dev server defaults to port **5174**, so it never contends with `pnpm dev`.
