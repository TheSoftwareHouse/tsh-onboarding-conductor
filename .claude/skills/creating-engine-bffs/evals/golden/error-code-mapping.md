# Mapping engine error codes in the BFF

**The BFF's own 502** — configuration or infrastructure the customer cannot act on:

- `404 WORKFLOW_NOT_FOUND` — the workflow id is the BFF's own configuration, not the caller's input
- `503 CONNECTOR_NOT_CONFIGURED` — an operator has not supplied a connector credential
- `503 AGREEMENT_NOT_PUBLISHED` — a step declares an agreement family with no published version;
  hit at start
- `500 OTP_DELIVERY_FAILED`, `SENDGRID_EMAIL_UNAVAILABLE`, `SUMSUB_UNAVAILABLE`
- any other engine 5xx, a transport failure, or a client-side timeout — never forwarded as-is

**Shown to the customer as a form error** — recoverable, the onboarding did not move:

- `400 INVALID_STEP_DATA` — carries `errors`, a field-to-code map of `UNKNOWN` / `REQUIRED` /
  `INVALID`; re-render the same step with those field errors
- `400 INVALID_DOCUMENT_UPLOAD` — re-render the upload control
- `409 DOCUMENT_UPLOAD_CONFLICT` and `409 DOCUMENT_UPLOAD_EXPIRED` — re-reserve the upload rather
  than fail

**Neither** — the attempt ends or the resource is gone:

- `404 ONBOARDING_NOT_FOUND`, `404 DOCUMENT_UPLOAD_NOT_FOUND` — the BFF's own 404
- `409 ONBOARDING_COMPLETED`, `MANUAL_TRANSITION_NOT_AVAILABLE`, `UNKNOWN_WORKFLOW_EVALUATION` —
  the BFF's own 409, terminal for the attempt
- `410 WORKFLOW_RETIRED` — 410

Two rules sit across the table. A `400` with no `code` at all is Nest's `ValidationPipe` shape
(`{ message: string[], error: "Bad Request", statusCode: 400 }`): it means the BFF built a bad
request and is never rendered to a customer. And no engine payload is re-thrown unchanged — the
BFF owns a fixed `{ code, message }` per outcome, and an unmapped code fails loudly in a test rather
than falling through to a generic branch.
