---
id: configuration
title: Configuration
sidebar_label: Configuration
description: How the engine is configured, what a fresh copy of the sample gives you, and which switches matter before a deployment.
---

→ Everything is configured through environment variables in `.env`. Start from `.env.dist`: it lists every variable with a comment explaining what it is for and what it must contain, and it is the place to look before searching the code.

## Two rules

- **A missing `.env` fails at start.** The engine reads `.env` only; `.env.dist` is the sample, never a fallback.
- **Configuration is validated at boot.** A wrong or missing value stops the start with a message naming it, rather than surfacing later on someone's onboarding.

## What a fresh copy gives you

A copy of `.env.dist` runs locally with no accounts anywhere. Emails go to MailHog instead of a real inbox, the example workflows use stand-in connectors, and the admin panel's sign-in is switched off so you can open it without an identity provider.

Provider credentials are not environment variables at all. Twilio Verify, SendGrid, SMTP and Sumsub credentials are **connector settings**: operators set them through the admin panel's Connectors tab or `PUT /v1/admin/connectors/{connectorId}`, and the database is the only place they live. Only deployment settings such as timeouts stay in `.env`.

## The variables, by area

Published ports follow one rule throughout: a `*_PORT` variable changes only what Docker Compose publishes to your machine. Inside the Compose network the engine reaches `postgres:5432`, `redis:6379`, `garage:3900` and `mailhog:1025` regardless, so the `*_URL` values need changing only for direct, non-Compose access from your host.

| Area                       | Variables                                                                                                                                                                    | Notes                                                                                                                                                                                                                                                                             |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                     | `MODE`, `PORT`, `ENGINE_PORT`, `NODE_ENV`, `ADMIN_PANEL_ORIGIN`                                                                                                              | `MODE` matters only for direct starts; Compose pins the engine to `api-only` and the worker to `worker-only`. `ADMIN_PANEL_ORIGIN` is the one origin the CORS check lets through, for the Vite dev server.                                                                        |
| Workflows and templates    | `WORKFLOWS_USERS_DIR`, `EMAIL_TEMPLATES_USERS_DIR`                                                                                                                           | Where your own workflows and email templates live. `built-in/` and `fixtures/` ship with the engine; fixtures are skipped when `NODE_ENV=production`.                                                                                                                             |
| Data                       | `DATABASE_URL`, `POSTGRES_PORT`, `REDIS_URL`, `REDIS_PORT`                                                                                                                   | Postgres holds everything; Redis carries the client-webhook queue.                                                                                                                                                                                                                |
| Documents                  | `STORAGE_DRIVER`, `STORAGE_S3_*`                                                                                                                                             | S3-compatible object storage for uploaded documents. Garage stands in locally and in CI; it publishes an S3 API on `STORAGE_S3_PORT` and no web console.                                                                                                                          |
| Providers                  | `TWILIO_VERIFY_TIMEOUT_MS`, `SUMSUB_BASE_URL`, `SUMSUB_TIMEOUT_MS`, `HTTP_CONNECTOR_TIMEOUT_MS`, `HTTP_CONNECTOR_SECRETS`                                                    | Deployment settings only; credentials are connector settings. `HTTP_CONNECTOR_SECRETS` is the JSON map a workflow's generic HTTP connector references as `{{secrets.<alias>.<key>}}`.                                                                                             |
| Stand-ins                  | `CONNECTOR_MOCKS`                                                                                                                                                            | Which mock stands in for which connector. Applied only when `NODE_ENV=test`; every other environment reads and ignores it.                                                                                                                                                        |
| Provider callbacks         | `CONNECTOR_CALLBACK_UNSIGNED_TYPES`                                                                                                                                          | Connectors whose provider does not sign callbacks. In production their callbacks are accepted only if listed here; a listed connector accepts unauthenticated requests on a guessable URL, so put a network allowlist in front. The signing secret itself is a connector setting. |
| Client webhooks            | `CLIENT_WEBHOOK_BASE_URL`, `CLIENT_WEBHOOK_TIMEOUT_MS`, `WEBHOOK_OUTBOX_*`                                                                                                   | Where the engine posts events about onboardings. Leave the URL empty to disable. HTTPS is required in production.                                                                                                                                                                 |
| Admin sign-in, engine side | `ADMIN_AUTH_ENABLED`, `ADMIN_SSO_PROVIDER`, `AZURE_TENANT_ID`, `AZURE_API_AUDIENCE`, `ADMIN_REQUIRED_ROLES`                                                                  | See below.                                                                                                                                                                                                                                                                        |
| Admin sign-in, panel side  | `VITE_AUTH_ENABLED`, `VITE_SSO_PROVIDER`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_API_SCOPE`, `VITE_AZURE_REDIRECT_URI`, `VITE_ENGINE_API_BASE_URL`      | Public identifiers only; the panel uses a browser authorization-code flow with PKCE, so no secret belongs anywhere in it.                                                                                                                                                         |
| Local inbox                | `MAILHOG_HTTP_PORT`                                                                                                                                                          | The MailHog UI. SMTP is never published to the host.                                                                                                                                                                                                                              |
| Data encryption            | `ENCRYPTION_KEY`, `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS`, `ENCRYPTION_SWEEP_POLL_INTERVAL_MS`, `ENCRYPTION_SWEEP_BATCH_SIZE`, `ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS` | Turned on and off from the admin panel, not here. See [Encrypting data at rest](#encrypting-data-at-rest) for the key you must configure first.                                                                                                                                   |

## Before you deploy

Operator sign-in uses Microsoft Entra ID and is **on unless explicitly turned off**, so a deployment that forgets to configure it refuses to serve admin data rather than serving it to anyone.

- `ADMIN_AUTH_ENABLED` is what protects onboarding data: with it on, every operator route requires a verified Entra access token carrying one of the roles in `ADMIN_REQUIRED_ROLES`. It defaults to on. Setting it to `false` is refused outright when `NODE_ENV=production`.
- `VITE_AUTH_ENABLED` only decides whether the panel renders its sign-in gate. It ships as `false` in the sample so a fresh clone runs without a tenant. Never deploy with it false.
- The two sides must name the same directory: `ADMIN_SSO_PROVIDER` on the engine and `VITE_SSO_PROVIDER` on the panel, both `azure` today, with `AZURE_API_AUDIENCE` matching the app registration `VITE_AZURE_API_SCOPE` is exposed by.

:::warning One route stays open
`POST /v1/onboardings/{id}/review/{action}`, the manual review decision, is not behind the operator guard today. Keep a network boundary in front of the engine's port. The [authentication page](/api/authentication) of the API reference has the details.
:::

## Encrypting data at rest

The onboarding form data a user submits (`onboardings.context`) can be encrypted before it reaches the database. You turn this on and off from the admin panel's **Encryption** page, or by calling `PATCH /v1/admin/encryption` with `{ "enabled": true }` or `{ "enabled": false }`. Nothing in `.env` switches it; what `.env` holds is the key that makes it possible.

### Before you can turn it on: the key-encryption key

Generate a key with:

```bash
openssl rand -base64 32
```

Put the result in `ENCRYPTION_KEY` on every engine process — `engine` and `engine-worker` alike — and restart. It must be exactly that: a base64-encoded 32-byte value, or the engine refuses to start and names the problem. Until it is set, the Encryption page shows that encryption cannot be turned on and says why.

`ENCRYPTION_KEY` does not encrypt your data directly. It is the key-encryption key: the engine uses it to wrap the data keys that actually protect `onboardings.context`, and stores those wrapped keys in the database rather than in the clear. Once any data key exists, the engine refuses to start without `ENCRYPTION_KEY`, because the data those keys protect would be unreadable.

:::danger Back up ENCRYPTION_KEY before you turn encryption on
There is no recovery path. Losing `ENCRYPTION_KEY` makes every data key it wrapped, and everything those keys ever encrypted, permanently unreadable — store it wherever you already keep other production secrets, and never in `.env.dist`, a commit, or a log.
:::

### Turning encryption on

Turning it on creates the first data key and encrypts every onboarding already stored, as well as every new write from then on. The change is not instantaneous: for one key-ring refresh interval (see below) the page shows the new key as pending activation while every engine process learns of it, and a background sweep then encrypts the stored rows a batch at a time. The page shows how many rows are still pending and how many there are in total, refreshing itself every few seconds until nothing is pending, so you can watch it converge to zero. Every onboarding stays fully readable throughout — a row the sweep has not reached yet is simply still plain JSON.

### Rotating the key

Rotate from the Encryption page's **Add key** action, or by calling `POST /v1/admin/encryption/keys`. Rotating adds a new data key, retires the previous one, and requires no downtime and no change to `ENCRYPTION_KEY`. The grace window applies as usual: the new key is reported as pending for one refresh interval before it protects new writes.

Nothing else moves. Rotation is lazy — a stored onboarding keeps naming the key it was written under, and migrates to the current key only the next time it is written. An onboarding that is never written again, a completed one above all, stays on its original key indefinitely. Expect the key ids in the database to stay mixed after a rotation; that is the design, not a sweep still catching up.

A retired key is never deleted — every key that has ever protected data stays in the key history, so a database dump still yields all of them. Rotation therefore limits exposure to data encrypted from that point forward, not exposure to what an earlier key already protected.

### Rotating on a schedule

The engine can also rotate the key by itself. The Encryption page's **Automatic key rotation** select offers every 48 hours, every 96 hours, every week, every 2 weeks, every 30 days, or off; turning encryption on leaves it **off**, because a rotation moves no stored data and so accumulates keys without reducing what any one of them protects. The equivalent call is `PATCH /v1/admin/encryption/rotation` with `{ "interval": "1w" }`, or `{ "interval": null }` to stop.

The countdown is the active key's age, not the moment you chose the interval. Adding a key yourself therefore starts it over, and so does each automatic rotation — the new key carries the same schedule. The flip side: choosing an interval shorter than the active key has already been alive makes a rotation due immediately, and the engine performs it within one check (`ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS`, a minute by default). The page tells you which case you are in, either naming the date of the next rotation or saying it is due now.

An automatic rotation is a rotation like any other: the same grace window, the same laziness, the same audit rows — recorded as the engine's own work (`system`) rather than an operator's. It runs only on a process started with `MODE=worker-only` or `MODE=all`, as the sweep does.

### Re-encrypting everything onto the current key

Rotation deliberately leaves stored data alone, so if a data key's material is ever exposed, the
rows written under it keep naming it. The Encryption page's **Re-encrypt all** action — or
`POST /v1/admin/encryption/reencryption` — is what moves them: it records a standing request, and
the background sweep works through every onboarding a batch at a time until all of them name the
current key.

Do this rather than turning encryption off and on again. Both end with everything on a fresh key,
but the off-and-on route writes every onboarding to disk as plain JSON in between, for however long
two full sweeps take — which is the opposite of what you want while responding to an exposed key.
The re-encrypt path decrypts and re-encrypts each row inside one transaction, so no onboarding is
ever stored unencrypted.

The page shows the same pending count as any other sweep, and the request clears itself when
nothing is left to move.

### Turning encryption off

Turning it off retires the active key and, after the same grace window, decrypts every stored onboarding back to plain JSON, a batch at a time. Once the page reports nothing pending, the database holds exactly what it would have held had encryption never been on. The key history remains, as a record; the audit log records who turned encryption on or off, and when.

### Tuning

Four settings tune the background work and how quickly a change reaches every running engine process:

- `ENCRYPTION_SWEEP_POLL_INTERVAL_MS` and `ENCRYPTION_SWEEP_BATCH_SIZE` — how often the sweep runs and how many rows it moves per pass. The sweep runs only on a process started with `MODE=worker-only` or `MODE=all`; a pure `MODE=api-only` process never runs it.
- `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` — how often each engine process refreshes its view of the current keys, and therefore how long every change waits before it takes effect. Leave the default unless you are running multiple engine processes and need a change to reach all of them faster.
- `ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS` — how often the engine checks whether the automatic-rotation schedule has come due. The schedule itself is not configured here; this only sets how promptly a due rotation is noticed.

If a row cannot be moved — its ciphertext no longer verifies, or it was encrypted under a key this engine's `ENCRYPTION_KEY` cannot unwrap — the sweep skips it, records one `encryption.reencryption_failed` or `encryption.decryption_failed` audit row naming the onboarding, and moves on; the pending count on the Encryption page then stays above zero until the cause is fixed.
