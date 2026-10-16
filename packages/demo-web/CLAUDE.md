# @tsh/demo-web

React 19 + Vite web app of the BNPL credit-check demo (ADR 0048, plan
`specifications/bnpl-algoan/`). It talks to `@tsh/demo-bff` over HTTP only — never to the engine,
never to Algoan — and has no workspace dependency on either, so the BFF's response shapes are
declared again in `src/api/bnpl/bnpl.client.ts`, deliberately.

## Commands

`pnpm demo:dev` at the root runs this app's `dev` server together with the BFF from `.env`.
`pnpm --filter @tsh/demo-web` `dev` (port 5173, strict) · `build` · `typecheck` · `lint` ·
`test` (Vitest, jsdom, co-located `*.spec.ts(x)` under `src/`) · `test:e2e` (Playwright, chromium,
headless, no retries; serves the production build itself unless `BASE_URL` is set).

## Runtime configuration

One value, the BFF origin: `VITE_BNPL_BFF_BASE_URL` (default `http://localhost:3100`).

- `pnpm dev` reads it from the repository's `.env` (`envDir: '../..'`) via `import.meta.env`.
- The container serves a static build behind nginx and renders `/config.js`
  (`window.__ENV__`) from its environment at start (`docker-entrypoint.sh`), so one image serves
  any origin. `src/config/runtime-env.ts` merges the two; a runtime value wins, an empty one is
  ignored.
- `index.html` loads `/config.js` as a classic, blocking script before the module bundle. Never
  add `defer`, `async` or `type="module"` to it.
- Read the origin only through `getBffBaseUrl()`; never `import.meta.env` directly.

## Journey

Pages live under `src/app/` (`details`, `consent`, `bank`, `result`, ...). One table in
`src/app/session/session-routes.ts` maps each engine step to the pages that may show while it is
current (`stepPath(step)` is the default); `useSessionView(page)` loads the session and redirects
to `pageFor(view)` when the page does not match. The home page offers one "Start a credit check"
and no scenario: the customer types their details, and the profile they sign in with at the
simulated bank (`bank/login`: High, Medium or Low score, one per visible persona) decides the
outcome. `/start/:persona` is a test-only link that preselects a persona (the hidden `fail_case`).
The bank journey (`bank`, `bank/login`, `bank/transfer`, `accounts`, `bank/consent`) is simulated
theatre: the bank list is a constant (`src/app/bank/banks.ts`), the bank's password is required
but any value passes and it never leaves the browser, and the transfer progress bar is decorative.
What the engine records goes through `submitSession` (`bank_selection`, `account_selection`,
`bank_access_consent`) and `bankLogin` (always `method: 'device'`; the workflow still accepts
`qr`); the authorise button on `bank/consent` submits the consent and then runs the credit check.
"Refuse" ends the session on that page: the engine cannot step back to the account selection.

## Styling

Tailwind 4 loaded through PostCSS (`postcss.config.js`), with the TSH tokens (palette, fonts,
radii) in `tailwind.config.ts`, pulled into `src/index.css` with `@config`. shadcn/ui's semantic
colours (`primary`, `muted`, `card`, ...) are CSS variables in `src/index.css` mapped onto the TSH
palette — change a colour there. shadcn components are checked in under `src/components/ui`
(generated per `components.json`, `new-york` style, `radix-ui` package); edit them in place, and
keep `cn` from `@/lib/utils`.

## Data access

Every BFF call goes through `src/api/bnpl/bnpl.client.ts`. A failure is a `BffError`
(`status`, `code`, `errors` for field validation). `waitForResult` long-polls `?wait=25` until the
session is `result`, asks for a `retry`, or the budget (default 180 s) ends; it returns a tagged
outcome and rejects with `AbortError` when its signal aborts.

## E2E

`e2e/smoke.spec.ts` loads `/` and asserts the app shell renders. `e2e/bnpl-journey.spec.ts` walks the
bank journey (one scenario per bank profile) through the real UI, BFF and engine (`credit-check`
fixture on `mock_credit`) and posts the mock callback to the engine itself.

`playwright.config.ts` starts the BFF (`pnpm --filter @tsh/demo-bff start:e2e`, port 3101, so a reuse can
only hit an e2e-started BFF and never a Compose one) and the web build (5173) unless `BASE_URL` is
set; an already-running server is reused outside CI. The
engine defaults to `http://localhost:3000` and storage to `http://localhost:3900` (the root
`pnpm test:e2e` stack); override with `ENGINE_BASE_URL` / `UPLOAD_PUBLIC_HOST` for a shifted stack.
The BFF is compiled with plain `tsc`: `nest build` (`deleteOutDir` + incremental build info) leaves
`dist` empty on a second run. `Fail Case` is a test-only BFF persona with no card, reached through
`/start/fail_case`.
