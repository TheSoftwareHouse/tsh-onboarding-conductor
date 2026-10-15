# @tsh/demo-bff

The backend-for-frontend of the BNPL demo (`docs/decisions/0048-demo-bff-and-web-packages.md`).
A browser cannot call the engine (its CORS allows one origin and no `POST`, and the customer routes
are unauthenticated), so this NestJS service calls it server-side and owns every authorization
decision. It holds no provider credentials; those live in the engine's connector settings.

Build and extend it with the `creating-engine-bffs` skill, and read its
`references/public-api-contract.md` before changing any call into the engine.
`docs/IMPLEMENTATION.md` outranks both. Conventions follow `packages/engine/CLAUDE.md`.

## Running it

`pnpm demo:dev` at the root (`scripts/demo-dev.cjs`) starts this BFF (`start:dev`, nest watch)
and the web app from the repository's `.env` against `ENGINE_BASE_URL`; `--tunnel` also opens a
cloudflared tunnel and recreates the Algoan subscriptions. `ConfigModule` reads `./.env` and
`../../.env`, so a `pnpm --filter @tsh/demo-bff start:dev` from the package works the same way.
A relative `PERSONAS_DIR` resolves against the repository root (`findRepoRoot`, the nearest
`pnpm-workspace.yaml`). The Compose `demo` profile sets its own `ENGINE_BASE_URL` and `PERSONAS_DIR`.

## Architecture

- `src/config/app.config.ts` — one validated `AppConfig`, wired with
  `ConfigModule.forRoot({ validate })`. No defaults and no `process.env` in feature code; a missing
  variable fails the boot. `docker-compose.yml` (profile `demo`) and `.env.dist` supply the values;
  `PERSONAS_DIR` is the one value post-processed after validation (relative → repository root).
- `src/engine/engine.client.ts` — the single class that calls the engine: start, state, submit,
  reserve and complete a document. Customer-facing routes only; never add an admin route.
- `src/engine/engine-error.ts` — internal `EngineError`: `status` (`null` for a transport failure or
  unreadable body), `code`, `message`, `errors`. Engine 4xx come as `{code, message}` or Nest's
  `{message: string[]}` with no `code` (`isValidationShape`, a defect in this BFF's own request).
- Errors are two-tier like the engine's: `*.error.ts` internal, `*.exception.ts` client-facing, each
  owning a fixed `{code, message}`. Never re-throw an engine payload; an engine 5xx or transport
  failure is this BFF's `502`. Map every engine code deliberately and fail a test on an unmapped one.
- Routes are versioned `@Controller('v1/bnpl/…')` and are this BFF's own contract, not a proxy.
- Routes: `GET personas`; `POST sessions` (`persona` optional, `null` until the bank login);
  `GET sessions/:token` (`?wait=`); `POST sessions/:token/submit`; `POST sessions/:token/bank-login`
  (`{ persona, method: 'qr' | 'device' }`: sets the persona, submits an opaque
  `bankConnectionReference`, the method and the persona's `bankProfile`; `409 SESSION_HAS_NO_BANK`
  off the `bank_connection` step, the only place a step name is read); `POST sessions/:token/run`.
- Accounts are opaque positions in the persona file (`account-01`, `account-02`); no IBAN, balance
  or bank data reaches the engine. `submit` rejects an `account_selection` without the `CHECKING`
  account (`400 INVALID_STEP_DATA`, `CHECKING_ACCOUNT_REQUIRED`); `run` pushes only the accounts in
  `/state.data.selectedAccounts` (`409 ACCOUNTS_NOT_SELECTED` when absent, `409 STEP_NOT_READY` when
  the engine refuses the `bankData` document because the onboarding is not on the credit step yet,
  the engine's `INVALID_DOCUMENT_UPLOAD`); a result lists only those accounts.
- `GET /v1/bnpl/sessions/:token/onboarding` is **test-only**: it returns the engine onboarding id the
  e2e suites need to post the `mock_credit` callback, and answers `404 SESSION_NOT_FOUND` unless
  `NODE_ENV=test` (optional in `AppConfig`, default `development`; the Compose service never sets
  it). No other response carries the id.

## Pitfalls

- `POST /submit` is not idempotent and runs the connector chain inline. A timeout does not mean the
  transition failed: re-fetch `/state`, never re-send. `ENGINE_REQUEST_TIMEOUT_MS` is configured, not
  defaulted, and must cover the slowest chain.
- Re-fetch `/state` after every submit, document completion and webhook; a submit does not return
  the next step. Render from the descriptor; never branch on a compiled step name.
- `ONBOARDING_AWAITING_CONNECTOR` (409) means parked on a provider: wait and poll `/state`, never
  resubmit. `/state.pending` is the same fact without the error.
- The presigned upload URL points at the engine's storage host (`http://garage:3900`). Replace only
  its origin with `UPLOAD_PUBLIC_HOST`; forward `fields` verbatim and send the file part last.
- The engine's webhook is unsigned and at-least-once: dedupe on `X-Webhook-Event-Id`, re-fetch
  `/state`, trust nothing in the body. Over HTTP the engine only accepts a loopback
  `CLIENT_WEBHOOK_BASE_URL`, and Compose does not forward it to `engine` yet.
- CORS allows `DEMO_WEB_ORIGIN` alone. Never accept an onboarding id from the client; map an
  unguessable session token to it.

Session and event maps are in-memory, unbounded and demo-grade: a restart drops every session.

## Commands

`pnpm --filter @tsh/demo-bff test | lint | typecheck | build`; the root scripts fan out to them.
Unit specs sit beside the code as `*.spec.ts`.
