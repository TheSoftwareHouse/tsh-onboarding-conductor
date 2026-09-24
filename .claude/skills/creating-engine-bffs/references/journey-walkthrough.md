# Walking a journey by hand

A verified `curl` transcript of everything a BFF does, against the local stack. Run it top to
bottom in one shell — each block is one command and every variable is assigned before it is used.
Use it to learn the contract, to reproduce a failure without the BFF in the way, and as the script
to re-run against the BFF's own routes once they exist.

Prerequisite: `pnpm stack:up`. The engine listens on `ENGINE_PORT` from `.env`, which is the
host-side port — `PORT` is the in-container one and is not what you call.

```bash
ENGINE=http://localhost:3000
```

## A full journey on the `base` fixture

`base` declares one agreement family, `base-terms`, and an onboarding cannot start on a workflow
whose declared family has no published version — the start answers `503 AGREEMENT_NOT_PUBLISHED`
carrying the `key`. Publish version 1 once, on a database that has none. The route is an operator
one, open locally because `.env.dist` ships `ADMIN_AUTH_ENABLED=false`; a BFF never calls it — a
`502` for `AGREEMENT_NOT_PUBLISHED` at start is what tells an operator to:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/admin/agreements" -H 'Content-Type: application/json' -d '{"key":"base-terms","type":"terms_and_conditions"}'
```

```jsonc
{"id":"01a0af29-f0ec-741a-9d31-429e5fb6b351","key":"base-terms","type":"terms_and_conditions","version":1,"publishedAt":"2026-09-17T11:39:16.585Z","linkedOnboardings":0}
HTTP 201
```

```bash
ONBOARDING_ID=$(curl -sS -X POST "$ENGINE/v1/onboardings" -H 'Content-Type: application/json' -d '{"workflowId":"base"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["onboardingId"])')
```

```bash
echo "$ONBOARDING_ID"
```

Read the step to render. The response is the whole descriptor; this prints the part a form needs:

```bash
curl -sS "$ENGINE/v1/onboardings/$ONBOARDING_ID/state" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps(d["step"],indent=2))'
```

```jsonc
{
  "name": "collect_email",
  "status": "awaiting_user",
  "canSubmit": true,
  "fields": [
    {
      "name": "email",
      "type": "text",
      "required": true,
      "active": true,
      "dependsOn": [],
      "schema": { "type": "string", "format": "email" },
      "value": null,
    },
  ],
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "properties": { "email": { "type": "string", "format": "email" } },
    "required": ["email"],
  },
}
```

Submit the wrong field name, to see the retryable error a BFF re-renders:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/submit" -H 'Content-Type: application/json' -d '{"emailAddress":"applicant@example.com"}'
```

```jsonc
{"code":"INVALID_STEP_DATA","message":"INVALID_STEP_DATA","errors":{"emailAddress":["UNKNOWN"],"email":["REQUIRED"]}}
HTTP 400
```

The onboarding did not move. Submit it properly:

```bash
curl -sS -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/submit" -H 'Content-Type: application/json' -d '{"email":"applicant@example.com"}'
```

```jsonc
{
  "appliedStep": "collect_email",
  "status": "awaiting_user",
  "currentStep": "accept_terms",
  "rejectionReason": null,
}
```

Note what is **not** there: the next step's fields. A BFF fetches `/state` again here.

The second step runs two mock KYC connectors, five seconds each. `time` is part of the lesson —
this is the call whose timeout a BFF has to size:

```bash
time curl -sS -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/submit" -H 'Content-Type: application/json' -d '{"acceptedTerms":true}'
```

```jsonc
{
  "appliedStep": "accept_terms",
  "status": "approved",
  "currentStep": null,
  "rejectionReason": null,
}
// curl … 10.052 total
```

Terminal state carries no step at all:

```bash
curl -sS "$ENGINE/v1/onboardings/$ONBOARDING_ID/state" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(json.dumps({k:d[k] for k in ("status","currentStep","terminal","step")}))'
```

```jsonc
{ "status": "approved", "currentStep": null, "terminal": true, "step": null }
```

Submitting again is permanently refused:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/submit" -H 'Content-Type: application/json' -d '{"acceptedTerms":true}'
```

```jsonc
{"code":"ONBOARDING_COMPLETED","message":"ONBOARDING_COMPLETED"}
HTTP 409
```

## Re-consent through the public accept route

The customer accepted `base-terms` version 1 on the `accept_terms` step. An operator publishing
version 2 links it to every onboarding that holds the family and marks their acceptance outdated:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/admin/agreements" -H 'Content-Type: application/json' -d '{"key":"base-terms","type":"terms_and_conditions"}'
```

```jsonc
{"id":"01a0af2a-2d0e-77d2-bdc6-431906a9700b","key":"base-terms","type":"terms_and_conditions","version":2,"publishedAt":"2026-09-17T11:39:31.981Z","linkedOnboardings":1}
HTTP 201
```

The admin read — `200` locally, admin-only everywhere else, so not a BFF's to proxy — shows what
the onboarding now owes:

```bash
curl -sS "$ENGINE/v1/onboardings/$ONBOARDING_ID/agreements"
```

```jsonc
{
  "onboardingId": "01a0af29-…",
  "items": [
    {
      "key": "base-terms",
      "type": "terms_and_conditions",
      "latestAgreementId": "01a0af2a-2d0e-77d2-bdc6-431906a9700b",
      "latestVersion": 2,
      "acceptedVersion": 1,
      "acceptedAt": "2026-09-17T11:39:31.836Z",
      "status": "outdated",
    },
  ],
}
```

A BFF learns that same `id` from the `onboarding.agreement_pending` webhook the publish emitted.
Here it is read off the admin route, locally, so the block stays self-contained:

```bash
AGREEMENT_ID=$(curl -sS "$ENGINE/v1/onboardings/$ONBOARDING_ID/agreements" | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["latestAgreementId"])')
```

Then the one public agreement route records the customer's answer:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/agreements/$AGREEMENT_ID/accept" -H 'Content-Type: application/json' -d '{}'
```

```jsonc
{"onboardingId":"01a0af29-f10c-70ba-a8e8-4d9c92690abb","agreementId":"01a0af2a-2d0e-77d2-bdc6-431906a9700b","key":"base-terms","version":2,"acceptedAt":"2026-09-17T11:39:32.053Z"}
HTTP 200
```

Repeating it answers the same body with the original `acceptedAt`, and the onboarding being
`approved` did not stop it. An id the onboarding does not hold is refused:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/onboardings/$ONBOARDING_ID/agreements/00000000-0000-7000-8000-000000000000/accept" -H 'Content-Type: application/json' -d '{}'
```

```jsonc
{"code":"AGREEMENT_NOT_FOUND","message":"AGREEMENT_NOT_FOUND"}
HTTP 404
```

## The document upload, on the `file-upload` fixture

```bash
UPLOAD_ID=$(curl -sS -X POST "$ENGINE/v1/onboardings" -H 'Content-Type: application/json' -d '{"workflowId":"file-upload"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["onboardingId"])')
```

Make a file that satisfies the step's `upload` constraints — a 1×1 PNG:

```bash
python3 -c "
import zlib, struct
def chunk(tag, data):
    body = tag + data
    return struct.pack('>I', len(data)) + body + struct.pack('>I', zlib.crc32(body) & 0xffffffff)
png = (b'\x89PNG\r\n\x1a\n'
       + chunk(b'IHDR', struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0))
       + chunk(b'IDAT', zlib.compress(b'\x00\xff\xff\xff'))
       + chunk(b'IEND', b''))
open('/tmp/tiny.png', 'wb').write(png)
"
```

```bash
UPLOAD_SIZE=$(wc -c < /tmp/tiny.png | tr -d ' ')
```

Reserve. `field` must be the active `file` field of the current step, and `contentType` and
`sizeBytes` are both checked against its declared `validation` before anything is signed:

```bash
curl -sS -X POST "$ENGINE/v1/onboardings/$UPLOAD_ID/documents" -H 'Content-Type: application/json' -d "{\"field\":\"identityDocument\",\"contentType\":\"image/png\",\"sizeBytes\":$UPLOAD_SIZE}" > /tmp/reserve.json
```

```bash
python3 -c "import json;r=json.load(open('/tmp/reserve.json'));print(r['documentId'], r['upload']['kind'], r['upload']['url'], r['expiresAt'])"
```

```text
01a0af28-ee5c-73cd-aaa9-a6934d533df4 post-form http://garage:3900/orchestrator-files 2026-09-17T11:43:10.396Z
```

That URL is the engine's own `STORAGE_S3_ENDPOINT`, so under Compose it names the in-cluster host.
The next block rewrites it to the published one — `localhost` on `STORAGE_S3_PORT` from `.env`,
3900 in `.env.dist` — which is safe: an S3 POST form signs the policy, not the host. Everything in
`fields` is forwarded verbatim and the bytes go last.

```bash
UPLOAD_ARGS=$(python3 -c "
import json, shlex
r = json.load(open('/tmp/reserve.json'))
url = r['upload']['url'].replace('garage:3900', 'localhost:3900')
print(' '.join('-F ' + shlex.quote(f'{k}={v}') for k, v in r['upload']['fields'].items()) + ' ' + shlex.quote(url))
")
```

```bash
eval curl -sS -o /dev/null -w '"HTTP %{http_code}\n"' -X POST $UPLOAD_ARGS -F "file=@/tmp/tiny.png"
```

```text
HTTP 204
```

```bash
DOCUMENT_ID=$(python3 -c "import json;print(json.load(open('/tmp/reserve.json'))['documentId'])")
```

Complete. This is where the engine reads the bytes back, sniffs the real MIME type, checks the size
and dimensions, and promotes staging → final:

```bash
curl -sS -w '\nHTTP %{http_code}\n' -X POST "$ENGINE/v1/onboardings/$UPLOAD_ID/documents/$DOCUMENT_ID/complete" -H 'Content-Type: application/json' -d '{}'
```

```jsonc
{"documentId":"01a0af28-ee5c-73cd-aaa9-a6934d533df4"}
HTTP 201
```

The `documentId` is then the field's value in the ordinary submit:

```bash
curl -sS -X POST "$ENGINE/v1/onboardings/$UPLOAD_ID/submit" -H 'Content-Type: application/json' -d "{\"identityDocument\":\"$DOCUMENT_ID\",\"documentLabel\":\"passport\"}"
```

```jsonc
{
  "appliedStep": "collect_identity",
  "status": "approved",
  "currentStep": null,
  "rejectionReason": null,
}
```

## Why the browser cannot do any of this

Ask the engine for permission to `POST` from the one origin it allows:

```bash
ADMIN_ORIGIN=$(grep '^ADMIN_PANEL_ORIGIN=' .env | cut -d= -f2-)
```

```bash
curl -sS -i -X OPTIONS "$ENGINE/v1/onboardings" -H "Origin: $ADMIN_ORIGIN" -H 'Access-Control-Request-Method: POST' | grep -i '^HTTP\|access-control'
```

```text
HTTP/1.1 204 No Content
Access-Control-Allow-Origin: http://localhost:5173
Access-Control-Allow-Methods: GET,PUT,PATCH,DELETE,OPTIONS
Access-Control-Allow-Headers: Authorization,Content-Type
```

`POST` is absent, and any other origin is refused outright. `curl` succeeded throughout this
document only because it sends no `Origin` header — which is exactly the position a server-side BFF
is in, and the reason one is required.

## What an admin route answers locally, and why that is a trap

```bash
curl -sS -w '\nHTTP %{http_code}\n' "$ENGINE/v1/onboardings/$ONBOARDING_ID"
```

```jsonc
{"onboardingId":"01a0…","workflowId":"base","workflowVersion":1,"status":"approved","currentStep":null,
 "expiresAt":null,"createdAt":"…","updatedAt":"…","completedAt":"…","rejectionReason":null,"scores":{},
 "agreementStatus":"current"}
HTTP 200
```

That `200` is not permission — it is `ADMIN_AUTH_ENABLED=false`, the shipped default in `.env.dist`
and a local-only escape hatch the engine refuses to start with once `NODE_ENV=production`. The same
call answers `401` wherever auth is on, and `403` for a token whose roles miss
`ADMIN_REQUIRED_ROLES`. A BFF built against a local engine can therefore proxy an admin route,
pass every local test, and fail in every real environment.

Set `ADMIN_AUTH_ENABLED=true` in `.env` before trusting any local result about what a BFF may
reach, or simply hold the line that `/state` is the only customer-facing read.
