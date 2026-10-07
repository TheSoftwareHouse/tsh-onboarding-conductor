# The engine's public API contract

What a BFF may call, what it gets back, and what it must never proxy. Authoritative sources:
`packages/shared/openapi/engine.openapi.json` — the generated HTTP contract, held equal to the code
by a unit test — with `docs/IMPLEMENTATION.md` §11 and
`packages/engine/src/onboardings/onboardings.controller.ts` for the reasoning. Confirm a guard in
the controller rather than trusting this table alone — auth is declared per route with
`@AdminRoute()`, not per controller.

## Routes

| Route                                                     | Auth        | A BFF                                                                                             |
| --------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------- |
| `POST /v1/onboardings`                                    | none        | calls it — body `{ workflowId }`                                                                  |
| `GET /v1/onboardings/:id/state`                           | none        | calls it — the only customer-facing read                                                          |
| `POST /v1/onboardings/:id/submit`                         | none        | calls it — body is the step's own fields                                                          |
| `POST /v1/onboardings/:id/documents`                      | none        | calls it — reserve an upload                                                                      |
| `POST /v1/onboardings/:id/documents/:docId/complete`      | none        | calls it — body `{}`                                                                              |
| `POST /v1/onboardings/:id/review/:action`                 | none        | calls it only if the BFF is an operator tool, never for a customer                                |
| `POST /v1/onboardings/:id/agreements/:agreementId/accept` | none        | calls it — empty body, `200`; the customer accepts a version the onboarding already holds         |
| `GET /v1/health/live`                                     | none        | may use it for readiness                                                                          |
| `GET /v1/onboardings`                                     | Entra JWT   | **never proxies** — the admin list                                                                |
| `GET /v1/onboardings/:id`                                 | Entra JWT   | **never proxies** — the admin record                                                              |
| `GET /v1/onboardings/:id/transitions`                     | Entra JWT   | **never proxies** — there is no `/history` route; this is the admin-only successor                |
| `GET /v1/onboardings/:id/agreements`                      | Entra JWT   | **never proxies** — accepted-versus-latest per agreement family                                   |
| `POST /v1/onboardings/:id/agreements`                     | Entra JWT   | **never proxies** — an operator links a published version out of flow                             |
| `/v1/admin/*`                                             | Entra JWT   | **never proxies** — audit, connectors, workflows, `step-types`, `workflows/compile`, `agreements` |
| `POST /v1/webhooks/:providerKey/callback`                 | per-adapter | never calls — providers call this, not the BFF                                                    |

`review/:action` takes `approve`, `reject` or `invalid` and answers `200`. It is public because the
engine has no operator identity for it; that makes exposing it to a customer a privilege
escalation the engine will not catch.

## Agreements

A workflow collects acceptance of an agreement family inside its own steps, and the client renders
that from the `/state` descriptor like any other field. The public accept route exists for the
other case: a newer version published after the customer has passed that step, which an operator
links with the admin `POST /v1/onboardings/:id/agreements` and which the engine announces with an
`onboarding.agreement_pending` webhook (below). The BFF then asks the customer, and records the
answer:

```
POST /v1/onboardings/:id/agreements/:agreementId/accept   {}
→ 200 { "onboardingId": "01a0…", "agreementId": "…", "key": "eu-b2c-terms", "version": 2, "acceptedAt": "…" }
```

Idempotent — a repeat reports the original `acceptedAt` — and not gated on the lifecycle status,
so an approved customer can still accept new terms. Only a version the onboarding already holds can
be accepted: anything else is `404 AGREEMENT_NOT_FOUND`, which is what keeps this open route from
attaching arbitrary versions to an onboarding. The `agreementId` to send is the `agreement.id` from
the webhook payload; there is no customer-facing read that lists what an onboarding owes, and the
admin `GET /:id/agreements` that does is not the BFF's to proxy.

## Start

```
POST /v1/onboardings   { "workflowId": "base" }
→ 201 { "onboardingId": "01a0…", "status": "awaiting_user", "currentStep": "collect_email", "expiresAt": null }
```

`CreateOnboardingDto` carries `workflowId` and nothing else, and the global `ValidationPipe`
whitelists, so **a revision cannot be pinned at start** — any `version` key is stripped. The engine
picks the highest **published** revision and pins the onboarding to it for its whole lifetime.
**`410 WORKFLOW_RETIRED` is not reachable at start.** Start resolves the highest _published_
revision, so a workflow whose revisions are all retired has no published row and answers
`404 WORKFLOW_NOT_FOUND` — which the BFF maps to 502, not 404. `410` appears only on `/state`,
`/submit` and `/documents`, for an in-flight onboarding whose pinned revision was retired after it
started.

## The `/state` descriptor

Everything needed to render the current step without knowing the workflow.

```jsonc
{
  "onboardingId": "01a0…",
  "workflowId": "base",
  "workflowVersion": 1,
  "status": "awaiting_user", // awaiting_user | awaiting_manual_review | approved | rejected | invalid
  "currentStep": "collect_email", // null once terminal
  "terminal": false,
  "rejectionReason": null, // ATTEMPTS_EXHAUSTED | CHALLENGE_EXPIRED | CHALLENGE_NOT_FOUND | CONNECTOR_REJECTED; set only when the move ends the onboarding as rejected (a rejection routed to a live step, e.g. CHALLENGE_EXPIRED -> resend, leaves it null)
  "step": {
    // null once terminal
    "name": "collect_email",
    "status": "awaiting_user",
    "canSubmit": true, // false when the step declares no success transition
    "fields": [/* below */],
    "schema": {/* JSON Schema for the active field subset */},
  },
}
```

Each field:

| Key         | Means                                                                                           |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `name`      | the key to send back in the submit body                                                         |
| `type`      | `text`, `boolean`, `date`, `number`, `array`, `object`, `file`                                  |
| `required`  | required **when active**                                                                        |
| `active`    | resolved against **persisted** context only                                                     |
| `when`      | the raw condition, so a client can re-resolve as the form fills                                 |
| `dependsOn` | the fields that `when` reads                                                                    |
| `schema`    | per-field JSON Schema, from the same compiler `submit` enforces                                 |
| `value`     | the persisted value for prefill, or `null`                                                      |
| `upload`    | `file` fields only: `contentTypes`, `maxSizeBytes`, optional `maxImageWidth` / `maxImageHeight` |

`active` is server-resolved against persisted context, so it is stale the moment a user types. A
client that hides fields must re-evaluate `when` locally against the form's current values; the
engine rejects a submitted field that is inactive at submit time.

**`currentStep` is a compiled step name.** Workflows are authored as typed steps, and one authored
step may compile to several — an `otp-verify` named `send_phone_code` produces `send_phone_code`,
`send_phone_code_verify` and `send_phone_code_resend` unless the author renames them through
`substeps`. The names a BFF sees are therefore a function of how the workflow was compiled, and
re-authoring a flow can rename a step without changing anything a customer does. Render from the
`/state` descriptor; never hard-code a step name in a branch. `pnpm workflow:compile <file> --report`
lists the compiled step names a given document produces.

## Submit

```
POST /v1/onboardings/:id/submit   { "email": "applicant@example.com" }
→ 201 { "appliedStep": "collect_email", "status": "awaiting_user", "currentStep": "accept_terms", "rejectionReason": null }
```

The body is exactly the step's active fields — the global `ValidationPipe` is bypassed here so that
workflow-configured names survive, which also means an unknown key is reported rather than dropped.
A `file` field's value is the `documentId` from a completed reservation.

The call runs the step's connector chain inline and returns only when it resolves. It does **not**
return the next step's descriptor: re-fetch `/state`.

**Sizing the timeout.** There is no engine-side ceiling to inherit: each connector's own timeout is
capped at 30 000 ms, a slot may spend up to `MAX_CONNECTOR_SLOT_RETRY_DELAY_MS` (20 000 ms) waiting
between retries, and a step may hold several slots in `order`. The number is therefore BFF policy —
start at `ENGINE_REQUEST_TIMEOUT_MS=60000` and raise it for a workflow with long chains. A client
timeout is a **502**, like any other transport failure; do not reach for 504, which would claim the
engine is a gateway the BFF is merely relaying.

**A submit is not idempotent.** It runs the connector chain, so a call that times out client-side
may well have applied the transition — the engine has no request-abort handling. Never re-send a
submit after a timeout: re-fetch `/state` and continue from whatever it reports.

When a step parks on an `async: true` connector the submit still returns normally; the onboarding
then advances only when the provider calls the engine's callback route. The BFF learns about it
from the `onboarding.state_changed` webhook or by polling `/state` — never by waiting on the submit.

## Errors

**Two shapes, not one.** Which one a 400 carries depends on what rejected it, and a BFF that only
parses `code` will read `undefined` for a whole class of failures.

A failure the engine's own code raises is `{ code, message }`, plus `errors` on
`INVALID_STEP_DATA`:

```jsonc
{ "code": "ONBOARDING_COMPLETED", "message": "ONBOARDING_COMPLETED" }
```

A failure the global `ValidationPipe` raises — a malformed `POST /v1/onboardings` body, a bad
`documents` reservation body, an unsupported `review/:action` — is Nest's own validation body,
with **no `code` at all**:

```jsonc
{ "message": ["workflowId should not be empty"], "error": "Bad Request", "statusCode": 400 }
```

That shape is guaranteed: `ValidationFailedException`
(`packages/engine/src/validation/validation-exception.factory.ts`) reproduces Nest's default body
byte-for-byte and only adds an out-of-band `fieldErrors` the audit filter reads. Branch on the
presence of `code`, and treat the validation shape as a defect in the BFF's own request building
rather than something to relay to a customer.

There is exactly one exception filter, `ApiFailureAuditFilter`, and it is **observation-only**: it
calls Nest's `BaseExceptionFilter` first and unchanged and then writes an `api.request_rejected`
(4xx) or `api.request_failed` (5xx) audit row. It never alters a status, a header or a body, so
nothing here changes because of it. There is no problem+json — the skeleton's
`OnboardingProblemDocument` no longer exists.

| Code                                                                                     | Status | BFF response                                                                      |
| ---------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------------------------- |
| `INVALID_STEP_DATA` — carries `errors`                                                   | 400    | re-render the same step with the field errors                                     |
| `INVALID_DOCUMENT_UPLOAD`                                                                | 400    | re-render the upload control                                                      |
| `ONBOARDING_NOT_FOUND`, `DOCUMENT_UPLOAD_NOT_FOUND`, `AGREEMENT_NOT_FOUND`               | 404    | 404                                                                               |
| `WORKFLOW_NOT_FOUND`                                                                     | 404    | 502 — the workflow id is the BFF's own config, not the caller's input             |
| `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION` | 409    | 409, terminal for the attempt                                                     |
| `ONBOARDING_AWAITING_CONNECTOR` — carries `pendingConnector`                             | 409    | wait and poll `/state`; do not resubmit — neither terminal nor a re-render        |
| `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED`                                    | 409    | re-reserve                                                                        |
| `WORKFLOW_RETIRED`                                                                       | 410    | 410                                                                               |
| `CONNECTOR_NOT_CONFIGURED`                                                               | 503    | 502 — an operator has not supplied a credential                                   |
| `AGREEMENT_NOT_PUBLISHED`                                                                | 503    | 502 — a step declares an agreement family with no published version; hit at start |
| `OTP_DELIVERY_FAILED`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`                | 500    | 502                                                                               |
| `OTP_SEND_LIMIT_REACHED`                                                                 | 429    | 429, terminal for sending — the code was sent the maximum number of times         |

`errors` maps a field name to codes: `UNKNOWN` (not declared on the step, or declared but
inactive), `REQUIRED` (active, required, absent) and `INVALID` (failed its schema). One bad submit
can report several at once — sending `emailAddress` where `email` was wanted yields
`{"emailAddress":["UNKNOWN"],"email":["REQUIRED"]}`.

## Documents

The engine never carries file bytes.

1. `POST /v1/onboardings/:id/documents` with `{ field, contentType, sizeBytes }`. `contentType` and
   `sizeBytes` are checked against the field's `validation` before anything is signed — but the
   engine resolves the file field by **name only** and never evaluates its `when`, so a reservation
   against a currently _inactive_ file field succeeds and signs a URL, and the later submit then
   rejects that field as `UNKNOWN`. Picking the field by `type === "file" && active` client-side is
   what prevents that wasted upload; the engine will not.
2. The response is a presigned POST form, valid 300 seconds:
   `{ documentId, upload: { kind: "post-form", url, fields }, expiresAt }`. The client posts
   `fields` verbatim as multipart with the bytes last, under the part name `file`, and gets `204`.
   The policy pins the key, the exact content type and an exact content-length range, so the bytes
   must match what was reserved.
3. `POST /v1/onboardings/:id/documents/:documentId/complete` with `{}` → `201 { documentId }`. The
   engine reads the staged object back, re-sniffs its MIME type from the bytes, checks size and
   image dimensions, and promotes it under an `If-Match` on the inspected ETag.
4. Submit the step with the `documentId` as the file field's value.

Find the field on the `/state` descriptor by `type === "file" && active` — a step declares at most
one, so that identifies it without knowing the workflow. **The browser posts the bytes directly to
storage**; the BFF reserves, rewrites the host and hands the form over, and never proxies the file
itself. That rewrite needs two variables of the BFF's own — the engine's `STORAGE_S3_ENDPOINT`
(`http://garage:3900` under Compose) and the origin a browser can actually reach — since the engine
publishes no browser-facing endpoint setting.

A live pending reservation for the same step and field is `409 DOCUMENT_UPLOAD_CONFLICT`; an
expired one is cleaned up and re-issued. Only one `file` field may exist per step, so a flow that
captures several documents captures them on consecutive steps.

## The outbound webhook

Configured engine-side with `CLIENT_WEBHOOK_BASE_URL` plus a workflow's
`"webhook": { "notify": { "path": "notify" } }`; an empty base URL disables delivery entirely.

```jsonc
POST <CLIENT_WEBHOOK_BASE_URL>/<path>
X-Webhook-Event-Id: <uuid>          // the only header of interest — there is no signature

{
  "version": 1,
  "event": { "id": "…", "type": "onboarding.state_changed", "occurredAt": "2026-09-07T11:45:29.651Z" },
  "onboarding": { "id": "…", "workflowId": "base", "workflowVersion": 1,
                  "status": "approved", "currentStep": null, "completedAt": "…" }
}
```

A second event type shares the envelope: `onboarding.agreement_pending`, sent once per link an
operator creates out of flow, with an `onboarding` block of `{ id, workflowId, workflowVersion,
status }` and an `agreement` block of `{ id, key, type, version, previousAcceptedVersion }` — the
`id` there is what the accept route takes. Branch on `event.type`; both arrive at the same path.

Mount the receiver on the BFF's own versioned surface (`v1/webhooks/<path>`); the workflow's
`notify.path` is the last segment. Two traps sit between that and a delivered event:

- **Over HTTP the base URL must target a loopback host, in every environment.** `http://<bff>:3001/…`
  throws `CLIENT_WEBHOOK_BASE_URL over HTTP must target a loopback host` at engine startup. A BFF on
  the Compose network therefore needs HTTPS, or must share the engine's network namespace so
  `localhost` reaches it.
- **`CLIENT_WEBHOOK_BASE_URL` is not in `docker-compose.yml`'s `engine` or `engine-worker`
  `environment:` block, and `.dockerignore` excludes `.env*`** — so setting it in `.env` reaches the
  containers not at all. Add it to both blocks in the same change that adds the receiver. An empty
  base URL disables delivery silently, with no error anywhere.

Answer `2xx` — `202` before doing any work — within `CLIENT_WEBHOOK_TIMEOUT_MS` (default 5 000 ms, validated between 100 and 30 000),
after which the engine abandons the delivery and counts it as a failed attempt. A non-2xx is
retried with exponential backoff up to five attempts, then the row terminalizes to `ERROR` and the
event is never delivered again.

Dedupe with an **atomic claim on a unique key** — `INSERT … ON CONFLICT DO NOTHING`, or Redis
`SET NX` — and act only when the claim was actually taken. An in-memory `Set` passes every local
test and fails on a second replica or a restart.

**Retain each claimed event id for 24 hours.** The engine's real delivery window is ~75 seconds:
five attempts at +0, +5 s, +10 s, +20 s, +40 s, after which the row terminalizes to `ERROR` and is
never delivered again. The `max_backoff_ms` of 300 000 never binds at five attempts, so do not
derive a retention from it. 24 h is headroom, not the requirement. Delivery is at-least-once and
unordered, and the engine commits the transition before enqueuing, so a client can observe a state
through `/state` before its notification arrives. Dedupe on the event id and re-fetch `/state`
rather than acting on the payload.
