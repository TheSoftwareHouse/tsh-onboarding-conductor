---
id: errors
title: Errors
sidebar_label: Errors
description: The two error envelopes, how to branch on them, and every error code with its status.
---

→ A refusal the engine owns answers with a stable `code` you branch on. A refusal the framework answers itself carries NestJS's own envelope and no `code`. Each route page lists exactly which codes it can return.

## The engine's envelope

```json
{ "code": "ONBOARDING_NOT_FOUND", "message": "ONBOARDING_NOT_FOUND" }
```

`code` is the identifier to branch on; `message` repeats it. Some codes add detail properties beside the two, described on the route that returns them. The most common is `INVALID_STEP_DATA`, which maps each refused field to its reasons:

```json
{
  "code": "INVALID_STEP_DATA",
  "message": "INVALID_STEP_DATA",
  "errors": { "acceptedTerms": ["INVALID"] }
}
```

## The framework's envelope

Where the framework answers instead of the engine, the body is NestJS's default shape. It appears for request validation (`400`, where `message` is a list naming each violated rule), for the admin bearer guard (`401`, `403`, `503`), and for a `500` on `POST /v1/onboardings/{id}/submit` and `POST /v1/webhooks/{providerKey}/callback`:

```json
{ "statusCode": 400, "message": ["workflowId should not be empty"], "error": "Bad Request" }
```

The `500` is the one case the framework answers after the handler ran rather than before. A connector adapter can fail with a plain error instead of one of the coded refusals below — an `http_request` call that could not be sent or answered with an unexpected status, or a Sumsub level or credential that does not resolve — and the engine lets it through. Those two routes are the only ones that call connectors this way; every other route's `500` carries a `code`. The connector, the step and the reason are in the audit trail.

A route page that can answer a status with either envelope shows both under that status.

## Every code, by status

| Status | Codes                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `400`  | `INVALID_STEP_DATA` (carries `errors`), `INVALID_DOCUMENT_UPLOAD`, `CONNECTOR_SETTINGS_INVALID` (carries `issues`), `WORKFLOW_INVALID` (carries `reason` and, when located, `path`), `WORKFLOW_CONNECTOR_DECLARATION_INVALID` (carries `stepName` and `detail`), `ASYNC_CALLBACK_RAW_BODY_REQUIRED`, `ASYNC_CALLBACK_PROVIDER_KEY_INVALID`, `ASYNC_CALLBACK_AUTHENTICATION_FAILED`, `AGREEMENT_TYPE_MISMATCH` (carries `key`, `publishedType` and `requestedType`) |
| `401`  | `ASYNC_CALLBACK_SIGNATURE_INVALID` when the caller is at fault                                                                                                                                                                                                                                                                                                                                                                                                     |
| `404`  | `ONBOARDING_NOT_FOUND`, `WORKFLOW_NOT_FOUND`, `DOCUMENT_UPLOAD_NOT_FOUND`, `CONNECTOR_NOT_FOUND`, `AGREEMENT_NOT_FOUND`                                                                                                                                                                                                                                                                                                                                            |
| `409`  | `ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION`, `DOCUMENT_UPLOAD_CONFLICT`, `DOCUMENT_UPLOAD_EXPIRED`, `WORKFLOW_SOURCE_KEY_CONFLICT` (carries `sourceKey` and `conflictingWorkflowId`), `AGREEMENT_VERSION_CONFLICT` (carries `key`)                                                                                                                                                                                    |
| `410`  | `WORKFLOW_RETIRED`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `500`  | `TWILIO_VERIFY_UNAVAILABLE`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`, `CLIENT_WEBHOOK_DELIVERY_FAILED`; on submit and the provider callback, also the framework's envelope carrying no code                                                                                                                                                                                                                                                             |
| `503`  | `CONNECTOR_NOT_CONFIGURED` (carries `connectorId` and `key`), `AGREEMENT_NOT_PUBLISHED` (carries `key`), `ASYNC_CALLBACK_SIGNATURE_INVALID` when the engine's own configuration is the gap                                                                                                                                                                                                                                                                         |

## Handling them

- Branch on `code`, not on `message`, and not on the status alone: `409` covers several distinct situations.
- A `400 INVALID_STEP_DATA` leaves the onboarding exactly where it was. Show the field errors and let the customer try again.
- A `409 ONBOARDING_COMPLETED` means the onboarding already reached a terminal status; read the state to learn which.
- A `503 CONNECTOR_NOT_CONFIGURED` is an operator's problem, not the customer's: a connector the step needs has a required setting with no value.
- A `503 AGREEMENT_NOT_PUBLISHED` is an operator's problem too: the workflow declares an agreement family with no published version, so no onboarding on it can start until one is published.
- A `500` from submit or the provider callback may carry no `code` at all. Check that `code` is present before branching on it; its absence means a connector failed in a way only the audit trail explains.
