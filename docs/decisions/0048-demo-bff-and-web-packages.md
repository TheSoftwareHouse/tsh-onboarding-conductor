# 0048. The BNPL demo is a separate BFF and web package behind a Compose profile

- **Status:** Accepted
- **Date:** 2026-10-15
- **Tags:** demo, bff, admin-panel, docker, bnpl, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

The BNPL demo ships as two workspace packages behind the Compose profile `demo`.
`@tsh/demo-bff` (NestJS, port 3100, built per the `creating-engine-bffs` skill) owns the demo
session: `POST /v1/bnpl/sessions` starts one onboarding per session and returns a
128-bit base64url token that identifies the session in the URL (`/s/<token>/…`), so any number
of sessions run side by side in separate tabs; the body's `persona` is optional and test-only (the
web app sends none; its unlinked `/start/:persona` route preselects the hidden `fail_case`).
The customer types their own details; the outcome is decided at the simulated bank's login,
where they sign in as a profile — High, Medium or Low score, one per visible persona — with a
required password that never leaves the browser, and `POST …/:token/bank-login { persona,
method }` records the profile on the engine's `bank_connection` step and binds the persona to the
session (amended 2026-10-16; the first cut chose the persona on the start page).
`POST …/:token/submit` pushes the current step's values for every step except the two the BFF
owns — `bank_connection` (`bank-login`) and `credit_check` (`run`), refused with
`409 SESSION_STEP_NOT_SUBMITTABLE` so the session's persona and the engine's record cannot
diverge; `…/:token/run` uploads the persona's bank data and submits the credit step;
`GET …/:token?wait=25` long-polls (25 s per request, 3 minutes overall) a state the
BFF refreshes by polling the engine's `/state` every two seconds while a request waits, and
immediately when `onboarding.state_changed` arrives at `POST /v1/bnpl/webhooks/engine`
(deduplicated on `X-Webhook-Event-Id`). The webhook is an accelerator, never a requirement: the
engine refuses a plain-HTTP `CLIENT_WEBHOOK_BASE_URL` on a non-loopback host outside
production, so inside Compose (`http://demo-bff:3100`) it cannot be configured without
weakening that guard, and the demo works without it. The BFF
holds four persona files under `packages/demo-bff/personas/en/` (two copied from Algoan's
MIT-licensed `fake-open-banking-data`, two authored here: the low-score persona and the hidden
`fail_case` whose analysis fails, for the retry path), re-bases their dates to today at push time
and uploads them as the step's `bankData` document — the engine therefore holds the persona's
accounts and transactions as a document, while the account selection sends only opaque
positions. `@tsh/demo-web` (Vite, React 19, Tailwind, shadcn/ui, TSH tokens, port 5173) renders
the start page, the details and consent steps, a simulated bank journey (bank selection, the
bank's login with the profile choice, a decorative transfer, account selection, the bank's
consent) of which only the selection, the login profile, the accounts and the consent reach the
engine, the "processing" state and the result tabs Algoan's showcase shows: Credit Score, Payment
Score, Credit Insights (categories, indicators, transactions), Accounts and raw JSON. Neither
package holds Algoan credentials; only the engine talks to Algoan.

A real-sandbox run needs Algoan to reach the engine's callback route. `pnpm demo:dev --tunnel`
opens a cloudflared quick tunnel straight at `ENGINE_BASE_URL` and creates the two Algoan
subscriptions for it, the same hand-started tunnel the Sumsub and Veriff manual tests used. The
tunnel publishes the whole engine, admin routes included, while the dev stack runs with
`ADMIN_AUTH_ENABLED=false`; it is for internal runs on a developer machine with sandbox
credentials only and never a deployment, and the guide says so (decided 2026-10-16).

## Context

The engine's public onboarding API has no auth, CORS for the admin origin only and no client
session concept, and the demo must run three predefined scenarios at once from a browser while
the result arrives through a webhook. A browser cannot receive that webhook, and the engine's
`onboarding.state_changed` delivery carries no outcome data
([0046](./0046-state-exposes-client-visible-data.md)), so something server-side has to bind a
browser session to an onboarding, receive the notification and let the browser wait on it.
`packages/demo-bff` and `packages/demo-web` already exist as placeholders for exactly this.

## Alternatives

| Option                                                          | Why not                                                                                                                                                                   |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serve the demo from the engine, next to the admin panel         | Puts persona data, a client session model and demo routes into the engine image for a showcase; the BFF pattern is the documented way to build against the public API     |
| The browser calls the engine directly with CORS opened          | No session binding, the persona files and the re-basing logic would live in the browser, and the browser still cannot receive the webhook                                 |
| Cookie-bound sessions                                           | One active session per browser; the user asked to run several scenarios at once                                                                                           |
| Server-sent events or WebSocket instead of long-poll            | More moving parts for a result that arrives once; long-poll keeps the BFF stateless beyond an in-memory map                                                               |
| Personae stored in the engine's fixtures                        | They are demo inputs, not engine behaviour; the engine's own fixtures use the `mock_credit` provider keyed by owner name                                                  |
| Choosing the scenario on the start page                         | Replaced on 2026-10-16: a real customer types their details and does not pick an outcome; the simulated bank's login is where a demo can still force one                  |
| A loopback relay so the tunnel publishes only the callback path | Declined on 2026-10-16: the tunnel is internal and test-only, as it was for the KYC manual tests; a relay adds a script and a recipe for an exposure the operator accepts |
| A per-step field allowlist in the BFF's `submit`                | The engine already refuses unknown fields; what the BFF must guard is only the two steps its own routes own                                                               |

## Consequences

`pnpm lint`, `typecheck`, `build` and `test` grow two packages; `docker compose --profile demo`
starts them with `CLIENT_WEBHOOK_BASE_URL` pointing at the BFF. Demo sessions live in memory and
are lost on BFF restart, which is acceptable for a showcase and noted in its README. The persona
licence file travels with the package. A second demo would reuse the BFF's engine client. The
bank journey is theatre, so a reader of the BFF must not take it for a bank integration; the
BFF's `CLAUDE.md` and the guide say which pages reach the engine. Anyone running `--tunnel`
accepts that the engine is public for the session; a stray quick tunnel also parks every run
that completes while it is dead, which the runbook's reconcile recipe unblocks.
