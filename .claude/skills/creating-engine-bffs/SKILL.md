---
name: creating-engine-bffs
description: "Builds and extends the backend-for-frontend that fronts the engine's public onboarding API — the NestJS service in packages/demo-bff: its engine client, the start/state/submit loop, document-upload reservation, the onboarding.state_changed webhook receiver, and mapping engine errors onto its own contract. Use when standing up a BFF against the engine, adding or changing a route in packages/demo-bff, writing or fixing an HTTP client that calls /v1/onboardings, wiring a web or mobile front end to an onboarding flow, proxying the document upload, receiving the state-changed webhook, mapping engine error codes onto a client-facing contract, or working out why a call into the engine returns 401, 409 or a CORS failure from a browser or a host service."
---

# Building a BFF against the engine API

The engine exposes the onboarding flow over HTTP, but not to a browser: CORS allows exactly one
origin and does not allow `POST` at all, and the customer-facing routes carry no authentication.
A BFF is the service that closes both gaps — it calls the engine server-side and is the only place
authorization exists. `packages/demo-bff` is that service and is an **empty placeholder today**:
name and version, no source, and no earlier skeleton in git history to recover.

The expensive mistake is writing the engine client from memory of what an onboarding API "should"
look like: a service-secret header the engine never reads, a `/history` route that does not exist,
and admin reads that sit behind Entra SSO everywhere except a developer machine. Take the scaffold
from `packages/engine`, the one NestJS service in the repository, and the contract from the live
controller and the OpenAPI document.

## Applicability and precedence

`docs/IMPLEMENTATION.md` is the as-built specification and **outranks this skill**: §11 for the
route list and error contract, §3 for the `/state` descriptor, §6 for outbound webhooks, §7 for
documents. `packages/shared/openapi/engine.openapi.json` is the engine's HTTP contract, generated
from the controllers and held equal to them by a unit test, so a shape that disagrees with this
skill is settled by the document. `packages/engine/CLAUDE.md` owns the NestJS conventions a second service in this
repository also follows — config, error tiers, module layout. Where any of them disagrees with this
skill, follow them and fix this skill.

This skill does not cover: workflow JSON (`creating-workflows`), connector adapters, the admin
panel, or the browser client that calls the BFF. Connector credentials are never the BFF's business
— an operator sets those in the admin panel's Connectors tab.

## Gotchas

Each of these is verified against a running engine, and every one of them is a mistake the engine
lets you make quietly.

- **A browser cannot call the engine, even from the allowed origin.** The preflight answers
  `Access-Control-Allow-Methods: GET,PUT,PATCH,DELETE,OPTIONS` — no `POST` — and the origin
  allowlist is `ADMIN_PANEL_ORIGIN` alone. Requests with no `Origin` header are allowed, which is
  what makes a server-side BFF work. Do not "fix" this by widening engine CORS.
- **The customer-facing routes have no authentication whatsoever.** Nothing in the engine reads a
  service secret or an `x-engine-service-secret` header, and the spec's API-key scheme was never
  built — do not invent one. Anyone who can reach the engine can drive any onboarding by id, so
  the engine must not be publicly routable and the BFF owns every authorization decision.
- **Only `/state` is a customer-facing read, and locally the engine will not stop you proving
  otherwise.** `GET /v1/onboardings/:id`, `/:id/transitions` and `/:id/agreements` sit behind
  `AzureJwtGuard`, but `.env.dist` ships `ADMIN_AUTH_ENABLED=false`, so they answer `200` on a
  developer machine and `401` everywhere auth is on. There is no `/history` route; `/:id/transitions`
  is its admin-only successor. Never proxy an admin route to an end user, and do not take a local
  `200` as evidence that you may.
- **`POST /submit` runs the connector chain inline.** It is not a queue hand-off: both submits against
  the `base` fixture block — 5 s on the first, **10 s** on the second while two mock KYC connectors deliberate, and a real
  chain may retry with delays on top. There is no engine-side budget to
  inherit: a slot may chain fallbacks, each retrying, each capped at 30 s. Derive the timeout from
  the slowest configured workflow's chain — 60 s is a sane default — and configure it, never
  default it; a default `fetch` timeout truncates the call and loses the transition.
- **A start can fail before any customer input.** A workflow that declares an agreement family
  answers `503 AGREEMENT_NOT_PUBLISHED`, carrying the `key`, until an operator has published a
  version of it with `POST /v1/admin/agreements` — on a fresh database, that is every declared
  family. It is the BFF's `502`, and the fix is operator-side, never a retry.
- **A submit does not return the next step.** The body is
  `{appliedStep, status, currentStep, rejectionReason}`. Re-fetch `/state` to render what comes
  next; `currentStep` and `step` are both `null` once `terminal` is true.
- **A 400 does not always carry a `code`.** The engine's own failures are `{code, message}`, but
  anything the global `ValidationPipe` rejects — a malformed start body, a bad reservation body, an
  unsupported `review/:action` — answers Nest's default shape,
  `{message: string[], error: "Bad Request", statusCode: 400}`, with no `code` at all. Branch on the
  presence of `code`; a client that reads `body.code` alone sees `undefined` and falls through.
- **`currentStep` is a compiled step name, and a workflow revision can change it.** Workflows are
  authored as typed steps and one authored step may compile to several
  (`send_phone_code`, `send_phone_code_verify`, …). Render from the `/state` descriptor and never
  branch on a hard-coded step name.
- **Three failures are recoverable, not one.** `400 INVALID_STEP_DATA` carries `errors` — a
  field-to-code map of `UNKNOWN` / `REQUIRED` / `INVALID` — and leaves the onboarding untouched, so
  re-render the same step. `400 INVALID_DOCUMENT_UPLOAD` re-renders the upload control. The two
  upload 409s mean re-reserve rather than give up, one per route: `DOCUMENT_UPLOAD_CONFLICT` on the
  reservation, `POST /v1/onboardings/:id/documents`, when a live pending one already holds that
  step's file field — complete it or let its 300 s lapse — and `DOCUMENT_UPLOAD_EXPIRED` on the
  completion, `POST /v1/onboardings/:id/documents/:documentId/complete`, when the reservation timed
  out before the bytes were confirmed. One 409 is neither recoverable nor terminal:
  `ONBOARDING_AWAITING_CONNECTOR` means the step is parked on a provider (a KYC check the customer
  already started), so the BFF waits and polls `/state` — never resubmits, since a resubmit would
  open a second provider attempt, which is exactly what the engine is refusing. Every other 4xx
  ends the attempt; `409 ONBOARDING_COMPLETED` in particular is permanent. **Recoverable describes
  what the BFF does next, never what the
  customer is shown**: the engine's `{code, message}` is not relayed verbatim in any of these cases,
  the BFF answers in its own error contract.
- **The presigned upload URL points at the engine's own storage host.** Under Compose it is
  `http://garage:3900` — the engine's `STORAGE_S3_ENDPOINT` — which no browser can resolve, and
  there is no separate browser-facing endpoint setting. Rewriting the host is safe — an S3 POST
  form signs the policy, not the host — but the `fields` must be forwarded verbatim and the file
  part sent last.
- **Outbound webhooks are unsigned and at-least-once.** `onboarding.state_changed` carries only
  `X-Webhook-Event-Id`, no signature, and ordering across events is not guaranteed. Treat it as a
  wake-up: dedupe on the event id, then re-fetch `/state`. Never let a webhook body authorize
  anything.
- **A submit is not idempotent, so a timeout is not a safe retry.** It runs the connector chain
  inline and the engine has no request-abort handling, so a call that times out client-side may
  already have applied the transition. Re-fetch `/state`; never re-send.
- **There is no engine client to import.** `@tsh/shared` is an empty placeholder, and `@tsh/openapi`
  holds only the generated document `packages/shared/openapi/engine.openapi.json` — no source, no
  client, no types. The engine client is hand-written; its types come from that document, which is
  the engine's HTTP contract, and from the DTOs it is generated from.

## Non-negotiable rules

| Severity | Rule                                                                                                                                                                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| MUST     | Scaffold from `packages/engine`'s own package files — its `package.json` scripts, `tsconfig.json`, `nest-cli.json`, `jest.config.cjs` and `Dockerfile` — and take the contract from the live controller and the OpenAPI document, never from memory of another onboarding API. |
| MUST     | Declare configuration as fields on one `AppConfig` class validated at startup, as `packages/engine/CLAUDE.md` requires. No hand-rolled config loader, no silent defaults.                                                                                                      |
| NEVER    | Read `process.env` in feature code, or fall back silently when a required variable is missing.                                                                                                                                                                                 |
| MUST     | Handle both engine error shapes: `{code, message}` and the `ValidationPipe`'s `{message: string[], error, statusCode}`. A response with no `code` is the BFF's own bad request, never a customer-facing message.                                                               |
| MUST     | Give the BFF its own two-tier errors — `*.exception.ts` for client-facing, `*.error.ts` for internal — each owning a fixed `{code, message}`. Never re-throw an engine payload unchanged.                                                                                      |
| NEVER    | Forward an engine 5xx or a transport failure to the caller as-is. An engine that is down is the BFF's `502`, not the customer's `500`.                                                                                                                                         |
| NEVER    | Expose an onboarding id to a client that has not been authorized for it. The id is the only thing the engine checks.                                                                                                                                                           |
| MUST     | Persist the principal → onboarding-id binding durably. The id must not leave the BFF, and every engine route that could look an onboarding up is admin-only, so losing the binding makes the onboarding unreachable.                                                           |
| MUST     | Re-fetch `/state` after every submit, document completion and webhook, rather than reconstructing the next step from the response you already hold.                                                                                                                            |
| MUST     | Version the BFF's own routes (`@Controller('v1/…')`) and keep them separate from the engine's shape — the BFF is a contract for its own client, not a proxy.                                                                                                                   |
| MUST     | Give the package `test`, `lint`, `typecheck` and `build` scripts. The root suites fan out with `pnpm -r --if-present`, so a package without a script silently never runs.                                                                                                      |
| MUST     | Add `packages/demo-bff/CLAUDE.md` and flip its row in `docs/IMPLEMENTATION.md`'s package table off "Empty placeholder" in the same change that gives it source.                                                                                                                |

## Reference loading

| Reference                                                     | Load when                                                                        | Covers                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Public API contract](references/public-api-contract.md)      | Before writing or changing any call into the engine, every time                  | Every route with its auth, request and response shape; the `/state` descriptor field by field; the error-code table; the webhook payload                                                                                                                             |
| [Journey walkthrough](references/journey-walkthrough.md)      | Proving a BFF against a running engine, or reproducing a failure by hand         | A verified `curl` transcript of a full journey, the document upload, and the CORS preflight, with real responses                                                                                                                                                     |
| `packages/shared/openapi/engine.openapi.json`                 | Typing a request or response, or confirming a route's auth and error codes       | The generated HTTP contract: every operation with its security requirement, request and response schemas, and the error codes it documents                                                                                                                           |
| `docs/IMPLEMENTATION.md` → §11, §3, §6, §7                    | The reasoning behind a contract is needed, or this skill and the engine disagree | HTTP surface, error contract, Entra auth, `/state`, the outbox, documents and object storage                                                                                                                                                                         |
| `packages/engine/CLAUDE.md`                                   | Writing the module, config or error classes                                      | Vertical modules, `AppConfig` + `validateConfig`, the two-tier error contract, route versioning                                                                                                                                                                      |
| `@tsh/ddl-schema` (`packages/shared/ddl-schema/src/index.ts`) | Typing the `/state` descriptor, or re-resolving a field's `when` client-side     | A real, implemented package — unlike `@tsh/shared`. Exports `WorkflowStatus`, `NormalizedWorkflowCondition`, `isNormalizedFileField`, and `evaluateCondition` / `collectConditionReferences`, the engine's own condition evaluator. Never reimplement `when` by hand |

## Procedure

**Step 1 — Scaffold from the engine, not from memory.** `packages/engine` is the one NestJS service
in the repository. Mirror the shape of its `package.json` scripts (`build`, `lint`, `typecheck`,
`test`, `test:cov`), its `tsconfig.json`, `tsconfig.spec.json`, `nest-cli.json` and
`jest.config.cjs` — each extending `tsconfig.base.json` or `jest.base.config.cjs` the way the
engine's do — and give the package a `Dockerfile` and a Compose service on the engine's pattern.
`docs/EXTENDING.md` → "Add a package" lists what joining the workspace requires.

**Step 2 — Reconcile every route against the live surface.** Read
[references/public-api-contract.md](references/public-api-contract.md), then confirm the guards
yourself — auth is declared per handler with `@AdminRoute()`, and only in the controller:

```bash
grep -n "@Post\|@Get\|@AdminRoute" packages/engine/src/onboardings/onboardings.controller.ts
```

**Step 3 — Configure.** One `AppConfig` class, `class-validator` decorators, wired through
`ConfigModule.forRoot({ validate: validateConfig })`. The engine base URL, the request timeout and
the workflow id the BFF starts belong here; document each new variable inline in `.env.dist`.

**Step 4 — Write the engine client as one class.** It owns the base URL, the timeout, JSON
encoding, and turning a non-2xx into a typed internal error carrying the status and the parsed
`{code, message, errors?}`. It does not decide HTTP semantics for the BFF's own caller — that is
the service's job, so the mapping stays in one readable place.

**Step 5 — Map errors deliberately.** Walk the code table in the contract reference and decide each
one: `INVALID_STEP_DATA` becomes the BFF's own field-error response, `ONBOARDING_NOT_FOUND` a 404,
`ONBOARDING_COMPLETED` a 409, `ONBOARDING_AWAITING_CONNECTOR` a "still waiting" answer that keeps
the client polling `/state`, everything else a 502. An unmapped code must fail loudly in a test,
not fall through to a generic branch.

**Step 6 — Prove it against a running engine.** Unit tests with a stubbed client prove the mapping;
they do not prove the contract. Bring the stack up with `pnpm stack:up` and walk
[references/journey-walkthrough.md](references/journey-walkthrough.md) against the BFF's own routes.
Do not reach for `pnpm stack:logs` — it follows and never returns.

**Step 7 — Join the repository, then report.** Add the four scripts, `packages/demo-bff/CLAUDE.md`,
the `docs/IMPLEMENTATION.md` package-table row and any `.env.dist` variables, run `pnpm format:fix`,
and say which engine routes the BFF now depends on.

## Self-check before handoff

```text
- [ ] Every engine route the client calls is public, and no admin route is proxied
- [ ] The client's timeout is derived from the slowest workflow's connector chain, and is configured, not defaulted
- [ ] `/state` is re-fetched after every submit, completion and webhook
- [ ] `INVALID_STEP_DATA` and `INVALID_DOCUMENT_UPLOAD` re-render; the two upload 409s re-reserve; `ONBOARDING_AWAITING_CONNECTOR` waits and polls `/state`; every other 4xx ends the attempt
- [ ] A 400 with no `code` is handled, and never rendered to a customer
- [ ] No branch keys on a hard-coded step name; rendering comes from the `/state` descriptor
- [ ] Engine 5xx and transport failures surface as the BFF's own 502, never verbatim
- [ ] Webhook handling dedupes on `X-Webhook-Event-Id` and trusts nothing in the body
- [ ] Configuration is a validated `AppConfig` class; no `process.env` in feature code
- [ ] `test`, `lint`, `typecheck` and `build` scripts exist, and the root suites pass
- [ ] `packages/demo-bff/CLAUDE.md` exists and `docs/IMPLEMENTATION.md` no longer calls it a placeholder
```
