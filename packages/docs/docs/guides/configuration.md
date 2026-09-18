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

| Area                       | Variables                                                                                                                                                               | Notes                                                                                                                                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Engine                     | `MODE`, `PORT`, `ENGINE_PORT`, `NODE_ENV`, `ADMIN_PANEL_ORIGIN`                                                                                                         | `MODE` matters only for direct starts; Compose pins the engine to `api-only` and the worker to `worker-only`. `ADMIN_PANEL_ORIGIN` is the one origin the CORS check lets through, for the Vite dev server.                                                                        |
| Workflows and templates    | `WORKFLOWS_USERS_DIR`, `EMAIL_TEMPLATES_USERS_DIR`                                                                                                                      | Where your own workflows and email templates live. `built-in/` and `fixtures/` ship with the engine; fixtures are skipped when `NODE_ENV=production`.                                                                                                                             |
| Data                       | `DATABASE_URL`, `POSTGRES_PORT`, `REDIS_URL`, `REDIS_PORT`                                                                                                              | Postgres holds everything; Redis carries the client-webhook queue.                                                                                                                                                                                                                |
| Documents                  | `STORAGE_DRIVER`, `STORAGE_S3_*`                                                                                                                                        | S3-compatible object storage for uploaded documents. Garage stands in locally and in CI; it publishes an S3 API on `STORAGE_S3_PORT` and no web console.                                                                                                                          |
| Providers                  | `TWILIO_VERIFY_TIMEOUT_MS`, `SUMSUB_BASE_URL`, `SUMSUB_TIMEOUT_MS`, `HTTP_CONNECTOR_TIMEOUT_MS`, `HTTP_CONNECTOR_SECRETS`                                               | Deployment settings only; credentials are connector settings. `HTTP_CONNECTOR_SECRETS` is the JSON map a workflow's generic HTTP connector references as `{{secrets.<alias>.<key>}}`.                                                                                             |
| Stand-ins                  | `CONNECTOR_MOCKS`                                                                                                                                                       | Which mock stands in for which connector. Applied only when `NODE_ENV=test`; every other environment reads and ignores it.                                                                                                                                                        |
| Provider callbacks         | `CONNECTOR_CALLBACK_UNSIGNED_TYPES`                                                                                                                                     | Connectors whose provider does not sign callbacks. In production their callbacks are accepted only if listed here; a listed connector accepts unauthenticated requests on a guessable URL, so put a network allowlist in front. The signing secret itself is a connector setting. |
| Client webhooks            | `CLIENT_WEBHOOK_BASE_URL`, `CLIENT_WEBHOOK_TIMEOUT_MS`, `WEBHOOK_OUTBOX_*`                                                                                              | Where the engine posts events about onboardings. Leave the URL empty to disable. HTTPS is required in production.                                                                                                                                                                 |
| Admin sign-in, engine side | `ADMIN_AUTH_ENABLED`, `ADMIN_SSO_PROVIDER`, `AZURE_TENANT_ID`, `AZURE_API_AUDIENCE`, `ADMIN_REQUIRED_ROLES`                                                             | See below.                                                                                                                                                                                                                                                                        |
| Admin sign-in, panel side  | `VITE_AUTH_ENABLED`, `VITE_SSO_PROVIDER`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`, `VITE_AZURE_API_SCOPE`, `VITE_AZURE_REDIRECT_URI`, `VITE_ENGINE_API_BASE_URL` | Public identifiers only; the panel uses a browser authorization-code flow with PKCE, so no secret belongs anywhere in it.                                                                                                                                                         |
| Local inbox                | `MAILHOG_HTTP_PORT`                                                                                                                                                     | The MailHog UI. SMTP is never published to the host.                                                                                                                                                                                                                              |
| Data encryption            | `ENCRYPTION_ENABLED`, `ENCRYPTION_KEY`, `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS`, `ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS`, `ENCRYPTION_REENCRYPTION_BATCH_SIZE`     | Off by default. See [Encrypting data at rest](#encrypting-data-at-rest) before turning it on.                                                                                                                                                                                     |

## Before you deploy

Operator sign-in uses Microsoft Entra ID and is **on unless explicitly turned off**, so a deployment that forgets to configure it refuses to serve admin data rather than serving it to anyone.

- `ADMIN_AUTH_ENABLED` is what protects onboarding data: with it on, every operator route requires a verified Entra access token carrying one of the roles in `ADMIN_REQUIRED_ROLES`. It defaults to on. Setting it to `false` is refused outright when `NODE_ENV=production`.
- `VITE_AUTH_ENABLED` only decides whether the panel renders its sign-in gate. It ships as `false` in the sample so a fresh clone runs without a tenant. Never deploy with it false.
- The two sides must name the same directory: `ADMIN_SSO_PROVIDER` on the engine and `VITE_SSO_PROVIDER` on the panel, both `azure` today, with `AZURE_API_AUDIENCE` matching the app registration `VITE_AZURE_API_SCOPE` is exposed by.

:::warning One route stays open
`POST /v1/onboardings/{id}/review/{action}`, the manual review decision, is not behind the operator guard today. Keep a network boundary in front of the engine's port. The [authentication page](/api/authentication) of the API reference has the details.
:::

## Encrypting data at rest

Set `ENCRYPTION_ENABLED=true` to encrypt the onboarding form data a user submits before it reaches the database. It is off by default, and the choice to turn it on is made once, in `.env`, before you deploy — there is no admin-panel switch and no per-workflow option.

Generate the key with:

```bash
openssl rand -base64 32
```

Put the result in `ENCRYPTION_KEY`. It must be exactly that: a base64-encoded 32-byte value, or the engine refuses to start and names the problem.

`ENCRYPTION_KEY` does not encrypt your data directly. It is the key-encryption key: the engine uses it to wrap the data key that actually protects `onboardings.context`, and stores that wrapped key in the database rather than the clear. On first boot with `ENCRYPTION_ENABLED=true`, the engine generates that first data key itself — turning the flag on needs nothing beyond `.env`.

:::danger Back up ENCRYPTION_KEY before you rely on it
There is no recovery path. Losing `ENCRYPTION_KEY` makes every data key it wrapped, and everything those keys ever encrypted, permanently unreadable — store it wherever you already keep other production secrets, and never in `.env.dist`, a commit, or a log.
:::

### Rotating the key

Rotate from the admin panel's Encryption keys screen, or by calling `POST /v1/admin/encryption/keys` directly. Rotating adds a new data key, retires the previous one, and requires no downtime and no change to `ENCRYPTION_KEY`.

Rotation is asynchronous. The request returns as soon as the new key is active; a background sweep then moves every onboarding still on the previous key onto the new one, a batch at a time. Every onboarding stays fully readable through the whole process — a row the sweep has not reached yet is simply still on its old key, which the engine still holds and can still decrypt. If you check the database immediately after rotating, expect to see rows on the old key; that is expected, not a fault. The panel's key history shows how many contexts are still pending and how many total, so you can watch the sweep converge to zero rather than guessing when it is done.

Three settings tune the sweep and how quickly a rotation reaches every running engine process:

- `ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS` and `ENCRYPTION_REENCRYPTION_BATCH_SIZE` — how often the sweep runs and how many rows it moves per pass. The sweep runs only on a process started with `MODE=worker-only` or `MODE=all`; a pure `MODE=api-only` process never runs it.
- `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` — how often each engine process refreshes its view of the current keys. Leave the default unless you are running multiple engine processes and need a rotation to reach all of them faster.

A rotated key is never deleted — every key that has ever protected data stays in the key history, so a database dump still yields all of them. Rotation therefore limits exposure to data encrypted from that point forward, not exposure to what an earlier key already protected.
