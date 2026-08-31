# 0001. Connector credentials are configurable at runtime through the admin API

- **Status:** Accepted
- **Date:** 2026-08-25
- **Tags:** connectors, credentials, security, encryption
- **Supersedes:** —
- **Superseded by:** —

## Decision

Connector credentials — the SendGrid API key, Twilio account SID/auth token/verify
service SID, SMTP username/password, and `http_request`'s workflow-named secret
aliases — are configurable by an operator at runtime through
`/v1/admin/connectors`, rather than being deployment-time environment
configuration. **The database is the only source.** A credential absent from
`connector_settings` is unconfigured, full stop, and raises
`503 CONNECTOR_NOT_CONFIGURED` at execute time — there is no environment
fallback, and the eight environment variables that used to feed one
(`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`,
`SENDGRID_API_KEY`, `SENDGRID_FROM`, `SMTP_USERNAME`, `SMTP_PASSWORD`,
`HTTP_CONNECTOR_SECRETS`) are deleted outright, not merely left unread.

Each connector type's settings are one flat `Record<string, string>` stored as
**plaintext JSON** in a `connector_settings` table. The engine performs no
encryption of its own — no crypto module, no encryption key — and delegates
confidentiality at rest entirely to the deployment database (an encrypted
volume, or a managed instance's transparent disk encryption). Each adapter
declares its own `settingsSchema` on the `ConnectorAdapter` port; there is no
central credential registry, and the settings code lives in `src/connectors/`,
the module that already owns the adapter registry, rather than in a module of
its own.

Out of scope: no admin-panel UI, no secret-manager integration, no key rotation
tooling (there is no key), and no caching of resolved settings — resolution
reads the `connector_settings` row on every connector execution.

## Context

Every credential a built-in connector adapter needs could previously only be set
through environment variables at deploy time, so rotating or supplying one
required a redeploy. The requirement was to let an operator supply and rotate
credentials at runtime instead. Two narrower choices were made first and then
reversed before this record was finalized: an environment fallback was briefly
kept so nothing existing would break, and confidentiality at rest was briefly
handled inside the engine with an authenticated symmetric cipher and a
generated key of its own. Both were withdrawn — the fallback
because a configuration that looks live but is silently overridden by a stored
row is worse than requiring every environment to configure through the API up
front, and the engine-side encryption because the operational cost (a key to
generate, store and rotate, with no rotation tooling built) was judged not worth
paying when the database can provide the same property. This record describes
only the design as shipped.

## Alternatives

| Option                                                                                                                         | Why not                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep environment variables as a deployment fallback alongside stored settings                                                  | A credential that looks configured in `.env` but is silently overridden by a stored row is worse than an explicit "reconfigure through the API"; it also leaves eight variables declared and half-read                |
| Encrypt settings inside the engine with an authenticated symmetric cipher, keyed by a required configuration secret            | Buys confidentiality against a database-only compromise, but costs a key to generate, distribute and rotate with no rotation tooling built, for a property the deployment database can already provide                |
| Adapters inject `ModuleRef` and look up the settings service lazily (`moduleRef.get(..., { strict: false })`) inside `execute` | Hides the dependency from the constructor as a service-locator lookup in four adapters, and leaves the underlying DI cycle for the next adapter author to rediscover; shipped briefly as a local unblock and reverted |
| A separate top-level `connector-settings` module                                                                               | Would need the adapter registry to resolve a type's schema, while the adapters would need the settings service back — a module cycle bought for nothing                                                               |

## Consequences

**Database access is now equivalent to credential access.** The `settings`
column holds plaintext JSON, and the engine adds no encryption of its own.
Anyone who can read the database — an operator with a `psql` connection, a
logical dump, a backup, a replica — reads every connector credential in clear.
This is stated plainly and accepted knowingly, not a gap to be discovered
later: application-level encryption would have kept the key inside the engine
process and left a bare dump useless on its own, and that protection is
deliberately not present. Whoever operates the database must treat it, and
every copy of it, with the same access discipline as the credentials
themselves.

The environment fallback's removal means every environment — local, CI, and
every deployment — must configure each real connector through the admin API
before it can run; nothing is read from `.env` on a connector's behalf any
more. The engine also boots with no connector credential configured anywhere,
and a workflow now loads while referencing an `http_request` secret nobody has
configured yet, because `parseHttpConnectorConfig` no longer proves every
`{{secrets.<alias>.<key>}}` reference resolvable at workflow-load time — a
secret configured at runtime cannot be proven present at boot. Both gaps
surface at execution time as `503 CONNECTOR_NOT_CONFIGURED` rather than at
startup, mirroring the trade already made for
`CONNECTOR_CALLBACK_SIGNING_SECRETS` (`docs/IMPLEMENTATION.md` §5).

An operator can still rotate a credential over the API and have it take effect
on the next execution, on every instance, with no restart. That immediacy is
bought with one primary-key lookup per connector execution instead of a config
read — a cache would go stale on every instance that did not serve the write,
so there is none.

Resolving credentials from inside an adapter while also depending on the
adapter registry closed a true DI cycle: `CONNECTOR_ADAPTER_COLLECTION` injects
every adapter, so an adapter injecting a service that depends on that
collection hangs Nest at bootstrap. The fix splits the service in two:
`ConnectorSettingsService` resolves values and depends only on the repository
and `DataSource`, so an adapter can inject it directly;
`ConnectorSettingsAdminService` owns the admin read/write surface and is the
only consumer that depends on `CONNECTOR_ADAPTER_COLLECTION`. A future
credential-bearing adapter declares a `settingsSchema` and calls `resolve(this)`
— no registry lookup, no new cycle.

Reversing the database-only decision is moderate, not cheap: it means
reintroducing the eight deleted environment variables, a merge/fallback step in
`ConnectorSettingsService`, and deciding a precedence again. Reversing the
plaintext-storage decision means reintroducing a crypto module, a required
encryption key, and a migration to re-encrypt every stored row — there is no
data to migrate today only because the feature has not yet been used in a real
deployment.
