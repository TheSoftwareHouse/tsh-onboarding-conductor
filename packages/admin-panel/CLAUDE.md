# Admin panel conventions — `packages/admin-panel`

Scoped rules for `packages/admin-panel/**`. The root `CLAUDE.md` applies in full; this file adds the
frontend conventions, and where noted overrides one of its global rules for this package's files.
Engine conventions are scoped to `packages/engine` and do not apply here.

The panel is a React 19 + Vite operator UI. It talks to the engine over HTTP with an Entra ID bearer
token and holds no business logic of its own — anything that decides an onboarding's fate belongs in
the engine, not here.

## Layout — feature-sliced

```
src/app/         App.tsx, providers.tsx, pages/, styles.css   — composition root
src/features/<feature>/
  api/           one module per endpoint call: request, Zod validation, projection
  components/    presentational and container components
  hooks/         use* hooks
  utils/         pure helpers
  types/         the feature's exported types and status contracts
  constants/     endpoint paths and other literals
  config/        configuration assembled at startup
  index.ts       the feature's public surface — the only thing other features may import
src/shared/      api/ (the axios client), lib/ (cross-feature pure helpers)
```

- **Cross-feature imports go through the barrel**: `import { … } from '@/features/auth'`, never a deep
  path into another feature. Inside a feature, use relative imports (`../types/admin-onboarding`).
- `@/` is the alias for `src/`, declared in both `vite.config.ts` and `vitest.config.ts`. Add a new
  alias to both or tests break in a way the build does not.
- A new feature is a new directory under `src/features/` with its own `index.ts`. Do not add a
  top-level directory beside `app`, `features` and `shared`.

## Components

- Named function declarations, **never default exports**. The file name is the component name in
  PascalCase: `OnboardingTable.tsx`.
- Every component exports an explicit `<Name>Props` interface and annotates its return as
  `ReactElement`.
- Semantic, accessible markup is the standard the existing components set: real `<table>` structure,
  `<th scope="col">`, a `<caption>` for screen readers, labelled inputs. Do not regress it with
  `<div>` scaffolding.
- Extract a magic number to a named module constant (`const TABLE_COLUMN_COUNT = 9`).

## Hooks

- `use<Thing>` in a file of the same name; co-located `*.spec.tsx` when it renders, `*.spec.ts` when
  it does not.
- Named `Use<Name>Options`, `Use<Name>Result` and `<Name>Props` interfaces are the convention here —
  see the override below.
- Split responsibilities the way `onboarding/hooks/` does: one hook owning the React Query call, one
  owning committed-vs-draft filter state, one composing them for the page.

## Data fetching and the API boundary

- All requests go through `@/shared/api/http-client` (one axios instance, `VITE_ENGINE_API_BASE_URL`
  base URL, a request interceptor attaching the bearer token). Never call `axios` or `fetch` directly.
- Endpoint paths live in the feature's `constants/endpoints.ts` as an `as const` object.
- **Validate every response with Zod at the boundary**, then project onto a named domain type. Request
  the payload as `unknown`, `safeParse` it, and map the validated record onto exactly the fields the UI
  needs — extra fields the engine may add are dropped rather than carried through. This is the global
  "no generic escape hatches" rule's dynamic boundary, so `unknown` here is correct.
- Be **permissive about open-ended values**. `status` is validated as a non-empty string, not a literal
  union: pinning it meant one status added by a migration rejected the whole response and left the
  operator with an empty list. Prefer a degraded row over no list.
- Each api module owns a feature-local error class extending `Error` with a `reason` union and an
  explicit `name`, and turns a failure into something an operator can act on — 401, 403 and 503 mean
  sign in again, ask for a role, and wait respectively, and a bare status code says none of that.
- React Query owns caching. The query key carries the already-normalized filters so the request always
  matches the cache entry it populates.

## Environment

Vite reads env from the repository root (`envDir: '../..'`), so panel variables live in the root
`.env` / `.env.dist` alongside the engine's. Only `VITE_`-prefixed variables reach the browser, and
they are mirrors of engine settings (`VITE_ENGINE_API_BASE_URL`, `VITE_SSO_PROVIDER`,
`VITE_AUTH_ENABLED`) — change a mirror and its engine-side counterpart together or the two disagree
at runtime.

## Tests

- **Vitest, not Jest.** Import `describe`, `it`, `expect`, `vi` from `vitest` explicitly; globals are
  not enabled.
- Co-located with the source. `jsdom` environment; `e2e/**` is excluded from the unit run.
- Testing Library only: `render`, `renderHook`, `act`, `userEvent`. Assert what an operator can see or
  do, not component internals.
- The Playwright suite under `e2e/` runs against a **real engine** via
  `e2e/run-direct-engine-playwright.cjs`, which also starts the Vite dev server on the port `BASE_URL`
  names. Drive it with `pnpm --filter @tsh/admin-panel test:e2e`, never `playwright` directly.

## Override — named parameter types are permitted here

The root file says: _"do not create a bespoke input type for every method."_ This package declares
named `<Name>Props`, `Use<Name>Options` and `Fetch<Name>Options` interfaces, and that is correct.
**This is an explicit override of that global rule, scoped to this package.**

A named parameter type is permitted when either holds:

1. **It is a React contract.** A component's props or a hook's options object _is_ the framework's
   calling convention. There is no domain object to pass instead, and naming it is what makes the
   boundary documented and testable.
2. **It is a single all-optional options bag.** The type is the function's only parameter and every
   member is optional, so `fn()` is a valid call — as with
   `fetchAdminOnboardings(options: FetchAdminOnboardingsOptions = {})`.

It is **not** permitted when it collects two or more values that could have been passed positionally.
That is what the global rule was written against, and its own counter-example still fails this test:

```ts
// Still forbidden — three required members wrapping objects the callee could take directly.
type EvaluateWorkflowInput = {
  data: OnboardingData;
  onboardingId: string;
  workflowVersion: number;
};
workflow.evaluate(input);

// Permitted — one parameter, every member optional, callable as fetchAdminOnboardings().
export interface FetchAdminOnboardingsOptions {
  filters?: AdminOnboardingFilters;
}
```

Return types are outside this override entirely: `Use<Name>Result` and friends are required by the
root file's "prefer concrete, named types for responses and payloads" rule, not excused by this one.

A helper in `utils/` or `lib/` that takes two or more required values follows the global rule and
passes them positionally.

## Accepted exception to the global naming rule

The root file names `normalizeAdminOnboardingFilters` as an example of a name to avoid, and that
function exists here: defined in `features/onboarding/utils/filter-admin-onboardings.ts`, exported from
the feature barrel, and called from five files.

**This is accepted and stays as it is. It is not a violation to report, and it is not to be renamed.**
Do not raise it in a review, do not "fix" it as drive-by cleanup, and do not treat it as evidence that
the naming rule is unenforced — renaming a barrel export would churn five files for no functional gain.

The rule still governs new code: prefer the simple form (`parseFilters`, `findAdapter`). Note why the
long name is worth avoiding rather than copying — the function already lives in
`features/onboarding/utils/filter-admin-onboardings.ts`, so `Admin` and `Onboarding` in the symbol
restate its own path.
