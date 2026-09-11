---
paths:
  - 'packages/**/*.spec.ts'
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
- Browser e2e uses Playwright, chromium-only and headless, with `baseURL` from the
  `BASE_URL` env var. Retries are disabled — a flaky test is a failing test.
- A new package joins the root suites only once it defines the matching `test`,
  `test:cov`, `test:e2e` or `test:integration` script, because the root scripts fan
  out with `pnpm -r --if-present`.
