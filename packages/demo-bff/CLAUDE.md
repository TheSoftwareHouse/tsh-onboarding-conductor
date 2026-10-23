# @tsh/demo-bff

The backend-for-frontend of the BNPL demo (`docs/decisions/0048-demo-bff-and-web-packages.md`).
A browser cannot call the engine (its CORS allows one origin and no `POST`, and the customer routes
are unauthenticated), so this NestJS service calls it server-side and owns every authorization
decision. It holds one provider credential, Lean's app token and secret, and only on the KSA
journey, to mint the widget's customer token (ADR 0049, 0052); every other credential lives in the
engine's connector settings.

It runs one of two journeys, chosen by `BNPL_JOURNEY` beside `BNPL_WORKFLOW_ID`
(`src/config/app.config.ts`): `uk-algoan` (default; `uk-bnpl-credit-check-algoan`, a simulated
bank and a persona document pushed to Algoan) or `ksa-lean-algoan` (`ksa-bnpl-lean-algoan`, Lean's
widget links a sandbox bank, the engine exports the data, Algoan scores it). Every session view
reports `journey`, and `GET /v1/bnpl/journey` answers it before any session.

Build and extend it with the `creating-engine-bffs` skill, and read its
`references/public-api-contract.md` before changing any call into the engine.
`docs/IMPLEMENTATION.md` outranks both. Conventions follow `packages/engine/CLAUDE.md`.

## Running it

`pnpm demo:dev` at the root (`scripts/demo-dev.cjs`) starts this BFF (`start:dev`, nest watch)
and the web app from the repository's `.env` against `ENGINE_BASE_URL`; `pnpm demo:dev:tunnel` (the same runner with `--tunnel`) also opens a
cloudflared tunnel and recreates the Algoan subscriptions. `ConfigModule` reads `./.env` and
`../../.env`, so a `pnpm --filter @tsh/demo-bff start:dev` from the package works the same way.
A relative `PERSONAS_DIR` resolves against the repository root (`findRepoRoot`, the nearest
`pnpm-workspace.yaml`). The Compose `demo` profile sets its own `ENGINE_BASE_URL` and `PERSONAS_DIR`.

## Architecture

- `src/config/app.config.ts` — one validated `AppConfig`, wired with
  `ConfigModule.forRoot({ validate })`. No defaults and no `process.env` in feature code; a missing
  variable fails the boot. `docker-compose.yml` (profile `demo`) and `.env.dist` supply the values;
  `PERSONAS_DIR` is post-processed after validation (relative → repository root). `LEAN_CLIENT_ID`, `LEAN_CLIENT_SECRET`, `LEAN_AUTH_BASE_URL`,
  `LEAN_API_BASE_URL` and `DEMO_WEB_PUBLIC_ORIGIN` are optional, and required at boot when
  `BNPL_JOURNEY=ksa-lean-algoan`.
- `src/lean/lean-link.service.ts` — the Lean host-service half: `client_credentials` token with
  scope `api`, create-or-find the customer whose `app_user_id` is the onboarding id (lookup, create,
  lookup again on a refused create), then a token with scope `customer.<id>`. Never logs a token or
  a body; any refusal or transport failure is `502 LEAN_UNAVAILABLE`.
- The KSA journey has no personae: the applicant signs in to a mock bank with a test user from
  the Lean portal, and that user's accounts are the data. `GET personas` answers `[]` there, and a
  `persona` on `POST sessions` is `UNKNOWN_PERSONA`. No password exists anywhere.
- `src/engine/engine.client.ts` — the single class that calls the engine: start, state, submit,
  reserve and complete a document. Customer-facing routes only; never add an admin route.
- `src/engine/engine-error.ts` — internal `EngineError`: `status` (`null` for a transport failure or
  unreadable body), `code`, `message`, `errors`. Engine 4xx come as `{code, message}` or Nest's
  `{message: string[]}` with no `code` (`isValidationShape`, a defect in this BFF's own request).
- Errors are two-tier like the engine's: `*.error.ts` internal, `*.exception.ts` client-facing, each
  owning a fixed `{code, message}`. Never re-throw an engine payload; an engine 5xx or transport
  failure is this BFF's `502`. Map every engine code deliberately and fail a test on an unmapped one.
- Routes are versioned `@Controller('v1/bnpl/…')` and are this BFF's own contract, not a proxy.
- Routes: `GET journey`; `GET personas` (the UK personae; `[]` on the KSA journey);
  `POST sessions` (`persona` optional, `null` until the bank login or bank link);
  `GET sessions/:token` (`?wait=`); `POST sessions/:token/submit` (reads `/state` first and refuses
  the two steps this BFF records itself with `409 SESSION_STEP_NOT_SUBMITTABLE` naming the owning
  route: `bank_connection` → `bank-login` and `credit_check` → `run` on the UK journey,
  `bank_connect` → `bank-link` and `credit_check` → `run` on the KSA one);
  `POST sessions/:token/bank-login` (UK: `{ persona, method: 'qr' | 'device' }`: sets the persona,
  submits an opaque `bankConnectionReference`, the method and the persona's `bankProfile`;
  `409 SESSION_HAS_NO_BANK` off the `bank_connection` step); `POST sessions/:token/bank-link` (KSA:
  `{}`: creates or finds the Lean customer, submits `{ leanCustomerId }` so the engine
  parks `bank_connect`, and answers `{ appToken, customerId, accessToken,
sandbox, permissions, accountType, successRedirectUrl, failRedirectUrl }` for `Lean.connect`; the
  redirect URLs are `DEMO_WEB_PUBLIC_ORIGIN/s/<token>/bank/waiting?lean_redirect=success|fail`; a
  second call while already parked mints a fresh token and submits nothing; `409 SESSION_HAS_NO_BANK`
  off `bank_connect`); `POST sessions/:token/run` (UK: uploads the persona's selected accounts;
  KSA: submits `{}` to start the assessment on the document the engine holds). Those guards, and
  the pass-through list below, are the only places a step name is read.
- Pass-through steps (KSA): whenever a read of `/state` lands on `bank_data_gate` — a `decision`
  step, which routes only on a submit — with nothing parked, the BFF submits `{}` and reads again
  (at most three times in a row), so the web app never sees that step.
- `waitingFor` on a `processing` view says what the engine is parked on: `bank` for
  `lean_bank_data`, `credit` otherwise; the web app shows "waiting for your bank" on the first.
- The account selection sends opaque positions (`account-01`, `account-02`), never an IBAN or a
  balance: positions in the persona file on the UK journey, positions in the document Lean's
  export wrote on the KSA one, where the accounts come from `/state.data.bankAccounts.accounts`
  (ADR 0050) and are mapped onto the same `accounts` shape with `owner: null`. `submit` rejects an
  `account_selection` without the `CHECKING` account (`400 INVALID_STEP_DATA`,
  `CHECKING_ACCOUNT_REQUIRED`) on both journeys; `run` pushes (UK) or starts (KSA) only with
  `/state.data.selectedAccounts` present (`409 ACCOUNTS_NOT_SELECTED` when absent,
  `409 STEP_NOT_READY` when the engine refuses the `bankData` document because the onboarding is
  not on the credit step yet, the engine's `INVALID_DOCUMENT_UPLOAD`, `503 CREDIT_CHECK_UNAVAILABLE`
  when the provider refuses the engine's credentials or the assessment, the engine's
  `CREDIT_PROVIDER_CREDENTIALS_REJECTED` / `CREDIT_PROVIDER_REJECTED` / `LEAN_UNAVAILABLE`); a
  result lists only those accounts. On the KSA journey the engine may answer `run` with
  `400 INVALID_STEP_DATA` on `selectedAccounts` coded `NO_ACCOUNTS_SELECTED` (the selection kept no
  account of the document); it passes through as is, the onboarding stays on `credit_check`, and the
  web app offers "Start over". The checking-account mirror makes it unreachable from the web app.
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
- CORS allows `DEMO_WEB_ORIGIN`, plus `DEMO_WEB_PUBLIC_ORIGIN` when set (the cloudflared URL the KSA
  demo is opened on; `pnpm demo:dev:tunnel` passes it in, and the dev server's proxy makes the
  browser's calls same-origin anyway). Never accept an onboarding id from the client; map an unguessable session
  token to it.
- The KSA journey cannot be driven end to end by an automated suite here: Lean's widget needs a
  human at the mock bank, and the engine's `lean_bank_data` reads Lean itself. The unit specs mock
  Lean with `fetch` spies up to the bank link; the rest is the manual runbook in the docs site's
  "UK BNPL credit check" guide (KSA section).

Session and event maps are in-memory, unbounded and demo-grade: a restart drops every session.

## Commands

`pnpm --filter @tsh/demo-bff test | lint | typecheck | build`; the root scripts fan out to them.
Unit specs sit beside the code as `*.spec.ts`.
