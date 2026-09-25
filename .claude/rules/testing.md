---
paths:
  - 'packages/**/*.spec.{ts,tsx}'
  - 'packages/**/*.e2e-spec.ts'
  - 'packages/**/jest*.cjs'
  - 'packages/**/playwright.config.ts'
---

# Testing

- `jest.base.config.cjs` at the root sets `testEnvironment: 'node'`,
  `clearMocks: true` and `restoreMocks: true`. Package configs extend it and must not
  restate those settings.
- Engine unit tests are co-located `*.spec.ts` files beside the source they cover.
- Engine e2e and integration tests live in `packages/engine/test/**/*.e2e-spec.ts`,
  configured by `packages/engine/test/jest-e2e.config.cjs`. Follow the existing
  pattern: set required env vars in `beforeAll`, dynamically import `AppModule`,
  build with `Test.createTestingModule`, start it with `startE2eServer(app)` from
  `test/e2e-server.ts`, and drive the app with `supertest` against
  `app.getHttpServer()`. Assert database side effects directly against the live
  `DataSource` where it matters.
- `startE2eServer` replaces a bare `app.init()` and is not optional. Handed a server
  that is not listening, `supertest` binds an ephemeral port per request and closes it
  again, and a full run's worth of that churn reissues ports under sockets Node still
  has pooled — a request then reaches a peer that is gone and fails as
  `Parse Error: Expected HTTP/, RTSP/ or ICE/`, far from whatever it was testing.
- A suite that runs the engine in a worker role drives a poller that reads the whole
  outbox, not just the rows that suite created. Neutralise what earlier suites left
  behind before opening such an app, the way `webhook-outbox-queue.e2e-spec.ts` does.
- The e2e suites set their own deterministic `ENCRYPTION_KEY`, so a key left in the shared volume by
  local use of the admin panel cannot be unwrapped: `EncryptionKeyRingService` refuses to start,
  every suite fails at `app.init()` with an error about unwrapping, and the encryption suite's own
  `DELETE FROM encryption_keys` teardown never runs because it needs a booted app. `pnpm test:e2e`
  handles it — `scripts/e2e-encryption-preflight.cjs` turns encryption off, waits for the decrypt
  sweep, and clears the key history before anything boots. It aborts rather than deleting keys if
  the sweep does not reach zero, because a row still naming a deleted key is unreadable for good.
  Nothing else may delete `encryption_keys` without decrypting first, for the same reason.
- Run engine e2e and integration specs against `pnpm stack:integration:up`, never `pnpm stack:up`.
  `stack:up` also starts the `engine-worker` container, which polls the webhook outbox
  continuously and competes with the in-process test app for the rows the specs assert on;
  `stack:integration:up` stops that worker first, and `scripts/test-e2e.cjs` (what CI runs)
  brings up only the `engine` service. Getting this wrong produces a rotating set of failures
  across runs rather than a consistent one, and can bake the stray worker's side effects into a
  spec's expectations.
- A single engine e2e spec runs with `JEST_E2E_SPEC=<file>.e2e-spec.ts pnpm --filter @tsh/engine
test:integration`; `test/jest-e2e.config.cjs` reads that variable to narrow `testMatch`.
- `packages/engine/tsconfig.json` sets `include: ["src/**/*"]`, so `pnpm typecheck` **never
  compiles `test/`**. A signature change that breaks an e2e call site is invisible to typecheck
  and surfaces only when the suite runs — check `test/` by hand when changing a shared signature.
- Browser e2e uses Playwright, chromium-only and headless, with `baseURL` from the
  `BASE_URL` env var. Retries are disabled — a flaky test is a failing test.
- A new package joins the root suites only once it defines the matching `test`,
  `test:cov`, `test:e2e` or `test:integration` script, because the root scripts fan
  out with `pnpm -r --if-present`.
