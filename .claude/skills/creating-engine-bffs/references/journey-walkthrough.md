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
// curl … 10.078 total
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
01a07bb0-0a33-7174-b7af-c0b6a3c252f0 post-form http://minio:9000/orchestrator-files 2026-09-07T11:50:29.651Z
```

That URL is the engine's own `STORAGE_S3_ENDPOINT`, so under Compose it names the in-cluster host.
The next block rewrites it to the published one, which is safe: an S3 POST form signs the policy,
not the host. Everything in `fields` is forwarded verbatim and the bytes go last.

```bash
UPLOAD_ARGS=$(python3 -c "
import json, shlex
r = json.load(open('/tmp/reserve.json'))
url = r['upload']['url'].replace('minio:9000', 'localhost:9000')
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
{"documentId":"01a07bb0-0a33-7174-b7af-c0b6a3c252f0"}
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
 "expiresAt":null,"createdAt":"…","updatedAt":"…","completedAt":"…","rejectionReason":null,"scores":{}}
HTTP 200
```

That `200` is not permission — it is `ADMIN_AUTH_ENABLED=false`, the shipped default in `.env.dist`
and a local-only escape hatch the engine refuses to start with once `NODE_ENV=production`. The same
call answers `401` wherever auth is on, and `403` for a token whose roles miss
`ADMIN_REQUIRED_ROLES`. A BFF built against a local engine can therefore proxy an admin route,
pass every local test, and fail in every real environment.

Set `ADMIN_AUTH_ENABLED=true` in `.env` before trusting any local result about what a BFF may
reach, or simply hold the line that `/state` is the only customer-facing read.
