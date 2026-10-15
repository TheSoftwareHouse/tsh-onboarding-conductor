---
id: authentication
title: Authentication
sidebar_label: Authentication
description: Which routes need a credential, what the bearer token must carry, how provider callbacks are verified, and the one route that stays open.
---

→ Three audiences, three postures. The onboarding flow is open and keyed by the onboarding id, the admin surface requires a Microsoft Entra ID access token, and a provider callback is verified with the HMAC recipe its connector adapter declares.

## The onboarding flow is unauthenticated

An end customer holds no operator identity, so `POST /v1/onboardings`, the state, submit, document and agreement-acceptance routes carry no credential. The onboarding id is the only handle: it is a capability, and a client that has it can drive that onboarding. Do not log it, do not put it in analytics, and let only the client that owns the onboarding see it.

## Admin routes require a bearer token

Every route under `/v1/admin/` and the operator routes on onboardings (`GET /v1/onboardings`, `GET /v1/onboardings/export`, `GET /v1/onboardings/{id}`, `GET /v1/onboardings/{id}/transitions`, `GET /v1/onboardings/{id}/agreements` and `POST /v1/onboardings/{id}/agreements`) carry the `entraBearer` security requirement:

```http
Authorization: Bearer <access token>
```

The token is a Microsoft Entra ID access token issued for the engine's API app registration, the one `AZURE_API_AUDIENCE` names, and its `roles` claim must hold at least one of the roles listed in `ADMIN_REQUIRED_ROLES` (`admin` by default, matched case-insensitively). A refused request is answered with the framework's envelope:

| Status                    | When                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `401 Unauthorized`        | No bearer token, or the token fails signature, issuer, audience or expiry verification.      |
| `403 Forbidden`           | The token verifies but carries none of the required roles. Signing in again cannot fix this. |
| `503 Service Unavailable` | Entra's signing key set could not be reached, so the token was never judged. Retry.          |

Every decision, granted or refused, is written to the audit log, so the trail answers who read admin data and not only who was turned away.

:::note Local runs
`ADMIN_AUTH_ENABLED=false` switches the guard off so a fresh clone runs without a tenant. It is a local-only setting: the engine refuses it when `NODE_ENV=production`.
:::

## Manual review is open today

`POST /v1/onboardings/{id}/review/{action}` records an operator's decision, yet it is not behind the bearer guard: the route predates admin sign-in and has not been moved behind it. Treat this as a known gap rather than a design intent, and keep a network boundary in front of the engine's port until it is closed.

## Provider callbacks are signed

`POST /v1/webhooks/{providerKey}/callback` is authenticated before anything else happens to the request. The connector adapter declares the recipe (which headers carry the signature and timestamp, the digest algorithm, the encoding, the tolerated clock skew) and the engine verifies it over the raw request body, byte for byte as the provider sent it. The signing secret is a connector setting stored beside the connector's other credentials, never an environment variable.

A refused callback answers `ASYNC_CALLBACK_SIGNATURE_INVALID` with one of two statuses: `401` when the caller is at fault (missing, malformed or mismatched signature, timestamp outside tolerance), `503` when the engine's own configuration is the gap (no signing secret stored, no callback recipe declared). The split matters because providers treat `401` as permanent and stop redelivering; `503` keeps their retry budget alive until an operator closes the gap.

Providers that do not sign at all must be listed in `CONNECTOR_CALLBACK_UNSIGNED_TYPES` before production accepts their callbacks, and a listed connector deserves a network or source-address allowlist in front of the route.
