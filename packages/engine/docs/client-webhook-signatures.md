# Verifying client webhook signatures

Every outbound notification we deliver is signed, so a client can prove the request came from this
engine and was not modified or replayed. The signature is an HMAC-SHA256 over the timestamp and the
raw request body, computed with a shared secret.

## What we send

```http
POST /webhooks/onboarding/state-changed HTTP/1.1
Content-Type: application/json
X-Webhook-Event-Id: 01912345-6789-7abc-8def-0123456789ab
X-Webhook-Timestamp: 1787047200
X-Webhook-Signature: v1=1b2c3d... v1=4e5f6a...

{"version":1,"event":{...},"onboarding":{...}}
```

| Header                | Notes                                                                          |
| --------------------- | ------------------------------------------------------------------------------ |
| `X-Webhook-Event-Id`  | Stable across retries of the same event; use it to deduplicate                 |
| `X-Webhook-Timestamp` | Unix seconds at which this attempt was signed; regenerated per attempt         |
| `X-Webhook-Signature` | Space-separated entries, one per active signing key, each `v1=<lowercase hex>` |

The signed string is `<X-Webhook-Timestamp>.<raw request body>`, joined with a literal `.` — for
example `1787047200.{"version":1,...}`.

## How to verify

1. Read the **raw** request body, before any JSON parsing. Re-serializing a parsed body can reorder
   keys or change whitespace, which invalidates the signature.
2. Reject the request if `X-Webhook-Timestamp` is outside your tolerance window. Five minutes is a
   reasonable default; this is what bounds replay of a captured request.
3. Compute `HMAC-SHA256(secret, "<timestamp>.<raw body>")` and hex-encode it.
4. Accept the request if **any** entry in `X-Webhook-Signature` matches, compared in constant time.
5. Deduplicate on `X-Webhook-Event-Id`: a retried delivery repeats the event id but carries a fresh
   timestamp and signature.

```js
const { createHmac, timingSafeEqual } = require('node:crypto');

const TOLERANCE_SECONDS = 300;

function verifyWebhook(rawBody, headers, secret) {
  const timestamp = Number(headers['x-webhook-timestamp']);
  if (!Number.isFinite(timestamp)) {
    return false;
  }

  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > TOLERANCE_SECONDS) {
    return false;
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest();

  return String(headers['x-webhook-signature'] ?? '')
    .split(' ')
    .filter((entry) => entry.startsWith('v1='))
    .map((entry) => Buffer.from(entry.slice(3), 'hex'))
    .some((received) => received.length === expected.length && timingSafeEqual(received, expected));
}
```

Comparing with `===` instead of a constant-time function leaks the expected signature through
response timing, so use `timingSafeEqual` or your language's equivalent.

## Why several signatures

`X-Webhook-Signature` carries one entry per signing key we currently hold, which makes key rotation
safe without a coordinated cutover:

1. We add the new key. Deliveries are now signed with both the old and the new key.
2. The client adds the new secret and accepts a match against either.
3. We drop the old key. The client drops the old secret.

No delivery fails at any step, because both sides always overlap on at least one key.

## Engine configuration

`CLIENT_WEBHOOK_SIGNING_SECRETS` holds the active keys as a JSON object of key id to secret:

```
CLIENT_WEBHOOK_SIGNING_SECRETS={"2026-08":"<32+ char secret>","2026-09":"<32+ char secret>"}
```

The key ids are for operator bookkeeping only and are not sent to clients. Each secret must be at
least 32 characters, and the variable is required whenever `CLIENT_WEBHOOK_BASE_URL` is set — the
engine refuses to start with an outbound webhook destination but no signing key, so deliveries can
never silently go out unsigned.
