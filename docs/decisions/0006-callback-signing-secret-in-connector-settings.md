# 0006. The inbound callback signing secret is a connector setting, not an environment variable

- **Status:** Accepted
- **Date:** 2026-08-31
- **Tags:** connectors, credentials, webhooks, security
- **Supersedes:** —
- **Superseded by:** —

## Decision

An adapter that declares `callbackAuth: {kind: 'hmac'}` declares its inbound signing
secret as a field on its own `settingsSchema` — `callbackSigningSecret`, secret and
required — and `CallbackSignatureVerifier` resolves it through
`ConnectorSettingsService` like every other connector credential. The
`CONNECTOR_CALLBACK_SIGNING_SECRETS` environment variable is deleted outright, not
left unread, so the `connectors` table becomes the only source for both halves of a
connector's credentials. `sumsub_kyc` is the only adapter affected today;
`mock_async_callback` declares `kind: 'none'` and is untouched.

A rotation window — the case the environment variable served by accepting a list of
secrets per adapter id — is expressed as a comma-separated value in the single stored
field, split by the verifier, which already compares against several candidates
without an early exit. A missing secret keeps its present behaviour exactly: the
callback route answers `503` at request time, never a startup failure.

`GET /v1/admin/connectors` reports the field like any other, so a connector missing
its signing secret reads as unconfigured in the admin surface instead of reporting
itself fully configured.

## Context

The signing secret is the one connector credential the admin API cannot see, and on
2026-08-31 that cost a debugging session. `GET /v1/admin/connectors/sumsub_kyc`
answered `"configured": true` — `appToken` and `secretKey` were both stored — while
`CONNECTOR_CALLBACK_SIGNING_SECRETS` was still `{}` from `.env.dist`. Sumsub delivered
a real `applicantReviewed` verdict three times; the engine recorded three
`webhook.inbound_callback_received` / `webhook.inbound_callback_rejected` pairs with
reason `signing_secret_missing` and answered `503` each time. Nothing in the operator's
own tooling said the connector could not receive a callback, and the gap was found by
reading Sumsub's webhook log, not the engine's.

`docs/IMPLEMENTATION.md` §4 states the reasoning for the present split: the secret
"must exist before the connector can receive its first callback, which the DB-backed,
runtime-editable path cannot guarantee at deploy time." That guarantee is weaker than
it reads. Nothing enforces it — an empty JSON object is a valid value, ships in
`.env.dist`, and satisfies every check the engine performs. The property the
environment variable actually provides is that the secret is _set where deployment
configuration is set_, not that it is _set_.

[0001](./0001-runtime-connector-credentials.md) already decided this question for
every other credential, deleting eight environment variables and making the database
the only source with no fallback. It explicitly notes that a runtime-configured secret
cannot be proven present at boot and that the resulting gap surfaces at execution time
as `503 CONNECTOR_NOT_CONFIGURED`, "mirroring the trade already made for
`CONNECTOR_CALLBACK_SIGNING_SECRETS`". The trade is already accepted; this record
applies it to the one credential 0001 left behind.

## Alternatives

| Option                                                                                   | Why not                                                                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the environment variable and assert at startup that every HMAC adapter has a secret | `docs/IMPLEMENTATION.md` §5 rejects this deliberately: "a missing deployment secret for one provider must not take the whole engine down." The assertion would also work against a database source, so it is not an argument for the environment variable — it is an orthogonal change this record does not need |
| Keep the environment variable and surface its presence on the admin read surface only    | Fixes the misleading `configured` flag without moving the secret, but leaves one connector configured through two mechanisms, and leaves rotation requiring a restart. The admin surface would report on a value it cannot change, which invites the obvious next question and answers it with "edit `.env`"     |
| Store it in the database with the environment variable as a fallback                     | 0001 rejected exactly this shape for the other eight credentials: a value that looks configured in `.env` but is silently overridden by a stored row is worse than requiring one source. Reintroducing the pattern for this field alone contradicts an accepted record                                           |
| Integrate a secret manager for callback secrets specifically                             | 0001 placed secret-manager integration out of scope for connector credentials generally; adopting one for a single field would split credential storage across two systems for no stated requirement                                                                                                             |

## Consequences

The admin panel stops overstating. `configured` becomes true only when a connector can
both call its provider and verify what the provider sends back, which is what an
operator reads that field to mean. The failure that prompted this record becomes
visible in the tool the operator is already looking at.

Rotation stops needing a restart. The environment variable accepts a list precisely so
a provider-side rotation window can be spanned, yet adding the incoming secret to that
list requires restarting the engine in the middle of rotating a live credential —
the case the feature exists for is the case it serves worst. A stored value takes
effect on the next callback, on every instance. Whether Sumsub webhook secrets are
rotated often enough for this to matter in practice is an assumption, not something
measured; it is stated here so a later reader can weigh it rather than inherit it.

**The deployment-time guarantee genuinely weakens, and this is the real cost.** Today
an operator who forgets the secret has at least written `{}` in a file next to every
other deployment value. Afterwards, an engine can boot, serve traffic and accept
webhook deliveries it is unable to verify, with the only signals being a `503` to the
provider and a `webhook.inbound_callback_rejected` audit row. The admin surface makes
that state visible, but visible is not the same as impossible, and nothing forces an
operator to look. A startup assertion would close it — for either storage choice — and
is deliberately not part of this decision.

Confidentiality at rest is unchanged in kind: the secret joins `appToken` and
`secretKey` as plaintext JSON in `connectors`, under the same terms 0001 accepted
knowingly. Anyone who can read the database can already read the credentials that
authenticate to the provider; adding the one that authenticates the provider to us
introduces no new class of exposure, but it does mean a database compromise now yields
everything needed to forge a callback as well as everything needed to impersonate the
engine outbound.

The rotation-window encoding is the one place this design is less expressive than what
it replaces. `settingsSchema` values are a flat `Record<string, string>`, so a list
becomes a comma-separated convention parsed by the verifier, and a secret containing a
comma cannot be stored. Provider-generated webhook secrets are hex or base64 in every
case the project has seen, so the constraint is theoretical today; making it explicit
in the field's documentation is part of the change rather than something to discover.

Reversal is cheap relative to 0001's: one environment variable to reintroduce, one
resolution path to restore, and no stored data to migrate — the project has no
deployed data, and a redeployment would re-supply the secret from whichever source
wins.

> **Amended 2026-10-05 by [0037](./0037-kyc-connector-kernel-and-providers.md):** the field name is
> per adapter. `ConnectorCallbackHmacAuth.secretSettingKey` names the `settingsSchema` key the
> verifier reads, defaulting to `callbackSigningSecret`; `veriff_kyc` names `sharedSecretKey`
> because Veriff signs both directions with one secret. Rotation semantics are unchanged — a
> comma-separated list, every entry verified inbound, the first entry signing outbound.
