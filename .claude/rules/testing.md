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
  build with `Test.createTestingModule`, call `app.init()`, and drive the app with
  `supertest` against `app.getHttpServer()`. Assert database side effects directly
  against the live `DataSource` where it matters.
- Browser e2e uses Playwright, chromium-only and headless, with `baseURL` from the
  `BASE_URL` env var. Retries are disabled — a flaky test is a failing test.
- A new package joins the root suites only once it defines the matching `test`,
  `test:cov`, `test:e2e` or `test:integration` script, because the root scripts fan
  out with `pnpm -r --if-present`.
