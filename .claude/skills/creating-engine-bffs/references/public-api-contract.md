# The engine's public API contract

What a BFF may call, what it gets back, and what it must never proxy. Authoritative source:
`docs/IMPLEMENTATION.md` §11 and `packages/engine/src/onboardings/onboardings.controller.ts`.
Confirm a guard in the controller rather than trusting this table alone — auth is declared per
route, not per controller.

## Routes

| Route                                                | Auth        | A BFF                                                              |
| ---------------------------------------------------- | ----------- | ------------------------------------------------------------------ |
| `POST /v1/onboardings`                               | none        | calls it — body `{ workflowId }`                                   |
| `GET /v1/onboardings/:id/state`                      | none        | calls it — the only customer-facing read                           |
| `POST /v1/onboardings/:id/submit`                    | none        | calls it — body is the step's own fields                           |
| `POST /v1/onboardings/:id/documents`                 | none        | calls it — reserve an upload                                       |
| `POST /v1/onboardings/:id/documents/:docId/complete` | none        | calls it — body `{}`                                               |
| `POST /v1/onboardings/:id/review/:action`            | none        | calls it only if the BFF is an operator tool, never for a customer |
| `GET /v1/health/live`                                | none        | may use it for readiness                                           |
| `GET /v1/onboardings`                                | Entra JWT   | **never proxies** — the admin list                                 |
| `GET /v1/onboardings/:id`                            | Entra JWT   | **never proxies** — the admin record                               |
| `GET /v1/onboardings/:id/transitions`                | Entra JWT   | **never proxies** — replaces the old `/history`                    |
| `/v1/admin/*`                                        | Entra JWT   | **never proxies**                                                  |
| `POST /v1/webhooks/:providerKey/callback`            | per-adapter | never calls — providers call this, not the BFF                     |

`review/:action` takes `approve`, `reject` or `invalid` and answers `200`. It is public because the
engine has no operator identity for it; that makes exposing it to a customer a privilege
escalation the engine will not catch.

## Start

```
POST /v1/onboardings   { "workflowId": "base" }
→ 201 { "onboardingId": "01a0…", "status": "awaiting_user", "currentStep": "collect_email", "expiresAt": null }
```

Omitting a version pins the onboarding to the highest **published** revision for its whole
lifetime. `WORKFLOW_NOT_FOUND` is a 404; a revision moved to retired answers `410 WORKFLOW_RETIRED`.

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
  "rejectionReason": null, // ATTEMPTS_EXHAUSTED | CHALLENGE_EXPIRED | CHALLENGE_NOT_FOUND | CONNECTOR_REJECTED
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

When a step parks on an `async: true` connector the submit still returns normally; the onboarding
then advances only when the provider calls the engine's callback route. The BFF learns about it
from the `onboarding.state_changed` webhook or by polling `/state` — never by waiting on the submit.

## Errors

Every error is `{ code, message }`, plus `errors` on `INVALID_STEP_DATA`. There is no exception
filter and no problem+json — the skeleton's `OnboardingProblemDocument` no longer exists.

| Code                                                                                     | Status | BFF response                                    |
| ---------------------------------------------------------------------------------------- | ------ | ----------------------------------------------- |
| `INVALID_STEP_DATA` — carries `errors`                                                   | 400    | re-render the same step with the field errors   |
| `INVALID_DOCUMENT_UPLOAD`                                                                | 400    | re-render the upload control                    |
| `ONBOARDING_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `DOCUMENT_UPLOAD_NOT_FOUND`                | 404    | 404                                             |
| `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION` | 409    | 409, terminal for the attempt                   |
| `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED`                                    | 409    | re-reserve                                      |
| `WORKFLOW_RETIRED`                                                                       | 410    | 410                                             |
| `CONNECTOR_NOT_CONFIGURED`                                                               | 503    | 502 — an operator has not supplied a credential |
| `TWILIO_VERIFY_UNAVAILABLE`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`          | 500    | 502                                             |

`errors` maps a field name to codes: `UNKNOWN` (not declared on the step, or declared but
inactive), `REQUIRED` (active, required, absent) and `INVALID` (failed its schema). One bad submit
can report several at once — sending `emailAddress` where `email` was wanted yields
`{"emailAddress":["UNKNOWN"],"email":["REQUIRED"]}`.

## Documents

The engine never carries file bytes.

1. `POST /v1/onboardings/:id/documents` with `{ field, contentType, sizeBytes }` — the field must be
   _the_ active `file` field of the current step, and both values are checked against its
   `validation` before anything is signed.
2. The response is a presigned POST form, valid 300 seconds:
   `{ documentId, upload: { kind: "post-form", url, fields }, expiresAt }`. The client posts
   `fields` verbatim as multipart with the bytes last, under the part name `file`, and gets `204`.
   The policy pins the key, the exact content type and an exact content-length range, so the bytes
   must match what was reserved.
3. `POST /v1/onboardings/:id/documents/:documentId/complete` with `{}` → `201 { documentId }`. The
   engine reads the staged object back, re-sniffs its MIME type from the bytes, checks size and
   image dimensions, and promotes it under an `If-Match` on the inspected ETag.
4. Submit the step with the `documentId` as the file field's value.

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

Answer `2xx` fast. A non-2xx is retried with exponential backoff up to five attempts, then the row
terminalizes to `ERROR` and the event is never delivered again. Delivery is at-least-once and
unordered, and the engine commits the transition before enqueuing, so a client can observe a state
through `/state` before its notification arrives. Dedupe on the event id and re-fetch `/state`
rather than acting on the payload.
