# Inbound connector callback signatures

Providers that finish work asynchronously call back into
`POST /v1/webhooks/:providerKey/callback`, where `providerKey` is the connector `type`. Those
requests are authenticated with HMAC before anything else happens to them.

Responsibility is split in two:

- **The connector adapter declares the recipe** — header names, digest algorithm, signature
  encoding, and whether a timestamp is folded into the signed message. That knowledge belongs to
  whoever integrates the provider.
- **The engine executes the check** — `CallbackSignatureVerifier` owns secret resolution,
  timing-safe comparison, replay bounding, and the HTTP contract, so none of that is reimplemented
  per adapter.

## Declaring the recipe

```ts
@Injectable()
export class AcmeKycConnector implements ConnectorAdapter {
  readonly name = 'acme_kyc';
  readonly type = 'acme_kyc';
  readonly supportsAsyncCallback = true;

  readonly callbackAuth: ConnectorCallbackHmacAuth = {
    kind: 'hmac',
    algorithm: 'sha256',
    signatureHeader: 'x-acme-signature',
    encoding: 'hex',
    timestamp: { header: 'x-acme-timestamp', toleranceSeconds: 300 },
  };
}
```

| Key                          | Required    | Notes                                                                 |
| ---------------------------- | ----------- | --------------------------------------------------------------------- |
| `kind`                       | yes         | `'hmac'` or `'none'`                                                  |
| `algorithm`                  | yes         | `sha256` or `sha512`                                                  |
| `signatureHeader`            | yes         | Matched case-insensitively                                            |
| `encoding`                   | yes         | `hex` or `base64`, as the provider sends it                           |
| `timestamp.header`           | no          | Integer epoch **seconds**; anything else is rejected                  |
| `timestamp.toleranceSeconds` | with header | Maximum absolute skew, past or future; the boundary value is accepted |
| `parseSignatureHeader`       | no          | Splits a packed header into candidate signatures                      |
| `buildSignedMessage`         | no          | Overrides what gets signed                                            |

The signed message defaults to the raw request body, or to `<timestamp>.<rawBody>` when a
timestamp header is declared. Override `buildSignedMessage` when a provider signs something else,
for example a canonical string built from headers.

Providers that emit several signature values during key rotation need
`parseSignatureHeader`; a callback verifies when **any** candidate matches **any** configured
secret:

```ts
parseSignatureHeader: (headerValue) =>
  headerValue
    .split(',')
    .filter((part) => part.startsWith('v1='))
    .map((part) => part.slice('v1='.length)),
```

## Signing secrets

`CONNECTOR_CALLBACK_SIGNING_SECRETS` is a JSON object keyed by connector `type`. A value is either
one secret or a list, because a provider-side rotation window needs both the outgoing and the
incoming secret to verify:

```
CONNECTOR_CALLBACK_SIGNING_SECRETS={"acme_kyc":["<current>","<previous>"]}
```

A malformed map fails startup. A signed connector whose type has no entry rejects every callback
at request time rather than at boot, so a missing deployment secret cannot take the whole engine
down.

## Connectors that do not sign

Some providers genuinely do not sign their callbacks. That has to be a declared decision, not an
omission, so the alternative is explicit:

```ts
readonly callbackAuth: ConnectorCallbackUnsignedAuth = {
  kind: 'none',
  justification: 'Provider offers no callback signing; only reachable in local development.',
};
```

One startup assertion in `ConnectorsModule` keeps this honest: an adapter with
`supportsAsyncCallback === true` and no `callbackAuth` fails startup, in every environment. That is
a code invariant — a callback-capable connector must state its posture.

Whether an unsigned connector may actually receive callbacks is a separate, deployment-level
decision, because registering an adapter is not the same as using it. In production, an unsigned
connector's callbacks are accepted only when its type is named in
`CONNECTOR_CALLBACK_UNSIGNED_TYPES`:

```
CONNECTOR_CALLBACK_UNSIGNED_TYPES=legacy_bank,acme_kyc
```

Outside production the list is not required and unsigned connectors are accepted by default, which
keeps local development and the test stack usable. Either way, an accepted unsigned callback logs
`CALLBACK_SIGNATURE_SKIPPED`, and a connector not opted into unsigned ingress in production is
rejected with `unsigned_connector_not_allowed`.

Naming a connector in that list means accepting unauthenticated, state-changing requests on a
guessable URL, so pair it with controls outside the engine — a network or source-IP allowlist in
front of the callback route is the usual minimum.

## What a caller sees

Every failure answers `401` with the same opaque body, so a caller cannot tell a missing header
from a wrong secret:

```json
{ "code": "ASYNC_CALLBACK_SIGNATURE_INVALID", "message": "ASYNC_CALLBACK_SIGNATURE_INVALID" }
```

The distinguishing reason is recorded in the `webhook.inbound_callback_rejected` audit record and
never returned to the caller:

| `reason`                         | Meaning                                                        |
| -------------------------------- | -------------------------------------------------------------- |
| `callback_auth_not_declared`     | Adapter reached verification with no declaration (fail closed) |
| `unsigned_connector_not_allowed` | `kind: 'none'` in production without an opt-in entry           |
| `signing_secret_missing`         | No secret configured for the connector type                    |
| `signature_header_missing`       | Declared signature header absent or blank                      |
| `signature_malformed`            | Value is not well-formed for the declared encoding             |
| `signature_mismatch`             | No configured secret reproduces any offered signature          |
| `timestamp_header_missing`       | Timestamp header absent, blank, or not integer epoch seconds   |
| `timestamp_out_of_tolerance`     | Timestamp outside the declared window, past or future          |

Verification runs on the raw bytes, after adapter resolution and before
`mapCallbackResult`, so an unauthenticated request never reaches the payload parser, the
correlation lookup, or any database write. No signature, secret, or body content is logged or
audited.

## Known limits

- **The callback URL is guessable.** `providerKey` is the connector type, so the signature is the
  only barrier for a signed connector, and an opted-in unsigned connector has no engine-level
  barrier at all — its protection has to come from the network layer.
- **Secrets are keyed by connector type.** That is correct for a dedicated adapter, and wrong for a
  generic one: two workflows could point a generic connector at unrelated providers, where "the
  secret for type `http_request`" has no meaning. Async-callback support for generic connectors
  needs a per-initiation callback token first.
- **No replay dedupe.** The timestamp window bounds how long a captured callback stays useful, but a
  replay inside that window is accepted. Dropping duplicates by provider event id requires
  persisting inbound callbacks.
- **HMAC only.** Asymmetric signatures, signed JWTs, and mTLS would each be a new `callbackAuth`
  variant.
- **Timestamps are epoch seconds only.** A provider using milliseconds or ISO-8601 needs the
  contract extended.
