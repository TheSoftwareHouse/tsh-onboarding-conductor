# A 409 on a second document upload

The code behind it is `409 DOCUMENT_UPLOAD_CONFLICT`, from `POST /v1/onboardings/:id/documents`:
a live, pending reservation already exists for the same step and field — the earlier presigned
form, valid 300 seconds, has neither been completed nor expired. An expired reservation is cleaned
up and re-issued instead, so the conflict only ever means the first upload is still in flight. Its
sibling on `POST .../documents/:documentId/complete` is `409 DOCUMENT_UPLOAD_EXPIRED`: the bytes
arrived after the reservation lapsed.

Both are recoverable and both mean "re-reserve", never "give up the attempt". If the client still
holds the pending form, complete that upload; otherwise reserve again — once the pending
reservation has expired the engine issues a fresh one — post the bytes to the new presigned form
with every `fields` entry forwarded verbatim and the file part last, complete it, and submit the
`documentId` as the file field's value. This is unlike `409 ONBOARDING_COMPLETED`, which is
permanent.

The engine's body is never relayed to the customer. The BFF maps the code onto its own error
contract — its own fixed `{ code, message }`, or simply a re-rendered upload control — and keeps the
engine payload in its own logs. Whatever the BFF renders next comes from a fresh `GET /state`, not
from the response it already holds.
