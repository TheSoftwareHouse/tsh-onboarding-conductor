# 0048. The BNPL demo is a separate BFF and web package behind a Compose profile

- **Status:** Proposed
- **Date:** 2026-10-15
- **Tags:** demo, bff, admin-panel, docker, bnpl, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

The BNPL demo ships as two workspace packages behind the Compose profile `demo`.
`@tsh/demo-bff` (NestJS, port 3100, built per the `creating-engine-bffs` skill) owns the demo
session: `POST /v1/bnpl/sessions { persona }` starts one onboarding per session and returns a
128-bit base64url token that identifies the session in the URL (`/s/<token>/…`), so any number
of personae run side by side in separate tabs; `POST …/:token/submit` and `…/:token/run` push
the steps; `GET …/:token?wait=25` long-polls (25 s per request, 3 minutes overall) a state the
BFF refreshes by polling the engine's `/state` every two seconds while a request waits, and
immediately when `onboarding.state_changed` arrives at `POST /v1/bnpl/webhooks/engine`
(deduplicated on `X-Webhook-Event-Id`). The webhook is an accelerator, never a requirement: the
engine refuses a plain-HTTP `CLIENT_WEBHOOK_BASE_URL` on a non-loopback host outside
production, so inside Compose (`http://demo-bff:3100`) it cannot be configured without
weakening that guard, and the demo works without it. The BFF
holds the three persona files under `packages/demo-bff/personas/en/` (two copied from Algoan's
MIT-licensed `fake-open-banking-data`, one authored here), re-bases their dates to today at push
time and uploads them as the step's `bankData` document. `@tsh/demo-web` (Vite, React 19,
Tailwind, shadcn/ui, TSH tokens, port 5173) renders the persona picker, the prefilled details
and consent steps, the "processing" state and the result tabs Algoan's showcase shows: Credit
Score, Payment Score, Credit Insights (categories, indicators, transactions), Accounts and raw
JSON. Neither package holds Algoan credentials; only the engine talks to Algoan.

## Context

The engine's public onboarding API has no auth, CORS for the admin origin only and no client
session concept, and the demo must run three predefined scenarios at once from a browser while
the result arrives through a webhook. A browser cannot receive that webhook, and the engine's
`onboarding.state_changed` delivery carries no outcome data
([0046](./0046-state-exposes-client-visible-data.md)), so something server-side has to bind a
browser session to an onboarding, receive the notification and let the browser wait on it.
`packages/demo-bff` and `packages/demo-web` already exist as placeholders for exactly this.

## Alternatives

| Option                                                  | Why not                                                                                                                                                               |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Serve the demo from the engine, next to the admin panel | Puts persona data, a client session model and demo routes into the engine image for a showcase; the BFF pattern is the documented way to build against the public API |
| The browser calls the engine directly with CORS opened  | No session binding, the persona files and the re-basing logic would live in the browser, and the browser still cannot receive the webhook                             |
| Cookie-bound sessions                                   | One active session per browser; the user asked to run several scenarios at once                                                                                       |
| Server-sent events or WebSocket instead of long-poll    | More moving parts for a result that arrives once; long-poll keeps the BFF stateless beyond an in-memory map                                                           |
| Personae stored in the engine's fixtures                | They are demo inputs, not engine behaviour; the engine's own fixtures use the `mock_credit` provider keyed by owner name                                              |

## Consequences

`pnpm lint`, `typecheck`, `build` and `test` grow two packages; `docker compose --profile demo`
starts them with `CLIENT_WEBHOOK_BASE_URL` pointing at the BFF. Demo sessions live in memory and
are lost on BFF restart, which is acceptable for a showcase and noted in its README. The persona
licence file travels with the package. A second demo would reuse the BFF's engine client.
