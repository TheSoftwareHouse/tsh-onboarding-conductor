---
id: authentication
title: Authentication
sidebar_label: Authentication
description: Which routes need a credential, how an operator's session and permissions are checked, and how provider callbacks are verified.
---

→ Three audiences, three postures. The onboarding flow is open and keyed by the onboarding id, the admin surface requires an operator's session cookie and the permission its route names, and a provider callback is verified with the HMAC recipe its connector adapter declares.

## The onboarding flow is unauthenticated

An end customer holds no operator identity, so `POST /v1/onboardings`, the state, submit, document and agreement-acceptance routes carry no credential. The onboarding id is the only handle: it is a capability, and a client that has it can drive that onboarding. Do not log it, do not put it in analytics, and let only the client that owns the onboarding see it.

## Admin routes require a session

Every route under `/v1/admin/` and the operator routes on onboardings (`GET /v1/onboardings`, `GET /v1/onboardings/export`, `GET /v1/onboardings/{id}`, `GET /v1/onboardings/{id}/transitions`, `GET /v1/onboardings/{id}/agreements`, `POST /v1/onboardings/{id}/agreements`, `POST /v1/onboardings/{id}/pending-connector/reconcile` and the manual review decision `POST /v1/onboardings/{id}/review/{action}`) carry the `adminSession` security requirement: a session cookie, `better-auth.session_token` (`__Secure-better-auth.session_token` over HTTPS), set by the engine's sign-in endpoints under `/v1/auth`. The cookie is `httpOnly` and `SameSite=Lax`, and a session lasts seven days.

```http
Cookie: better-auth.session_token=<session cookie>
```

There is no bearer token and no API key, so a service calling admin routes needs an operator account of its own. A browser front end must be served from, or be same-site with, the engine and send credentials; the engine answers cross-origin calls only for `ADMIN_PANEL_ORIGIN`.

### Who may sign in

Accounts are by invitation only: `POST /v1/auth/sign-up/email` for an address with no pending invitation is refused, whether or not the address is known.

```json
{ "message": "Sign-up is by invitation only." }
```

The first account, a superadmin, is created from `AUTH_SUPERADMIN_EMAIL` and `AUTH_SUPERADMIN_PASSWORD` on a fresh deployment. A superadmin creates organizations and invites operators into them; the invitation mail carries a link to `/accept-invitation/{invitationId}` on the engine's own origin, where the invitee signs up with a name and a password, or signs in, and accepts. Microsoft sign-in, when the deployment enables it, follows the same invitation rule.

### Two-factor authentication

Two-factor authentication (an authenticator app, TOTP) is optional: each operator turns it on or off for their own account, in the admin panel's Account page or through the calls below. No admin route refuses an operator for not having it. A Microsoft sign-in never asks for an engine code; require multi-factor authentication in the Microsoft tenant instead.

These calls turn it on for an account that has no TOTP yet. The first request's response carries the session cookie, and every later request sends it back.

```bash
$ curl -i -c cookies.txt -X POST http://localhost:3000/v1/auth/sign-in/email \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
    -d '{"email":"root@example.com","password":"<password>"}'
HTTP/1.1 200 OK
set-cookie: better-auth.session_token=<session cookie>; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax

{"redirect":false,"token":"<session token>","user":{"name":"Superadmin","email":"root@example.com","emailVerified":false,"image":null,"createdAt":"2026-11-16T11:21:32.636Z","updatedAt":"2026-11-16T11:21:32.636Z","twoFactorEnabled":false,"role":"superadmin","banned":false,"banReason":null,"banExpires":null,"id":"XzyBG9xz0rFya8U8qU0GXtdpXt2vrcxn"}}

$ curl -b cookies.txt -c cookies.txt -X POST http://localhost:3000/v1/auth/two-factor/enable \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
    -d '{"password":"<password>"}'
{"method":"totp","totpURI":"otpauth://totp/dev:root%40example.com?secret=<secret>&issuer=dev&digits=6&period=30","backupCodes":["<ten backup codes>"]}

$ curl -b cookies.txt -c cookies.txt -X POST http://localhost:3000/v1/auth/two-factor/verify-totp \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
    -d '{"code":"<six digits from the authenticator>"}'
```

`totpURI` is what an authenticator app scans as a QR code, and `backupCodes` are shown once. The `issuer` is the deployment's `ENVIRONMENT_NAME`. The verify call returns `200` and a fresh session cookie. From then on a password sign-in no longer returns a session directly; it asks for a code:

```bash
$ curl -i -c cookies.txt -X POST http://localhost:3000/v1/auth/sign-in/email \
    -H 'Content-Type: application/json' -H 'Origin: http://localhost:5173' \
    -d '{"email":"root@example.com","password":"<password>"}'
HTTP/1.1 200 OK
set-cookie: better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax
set-cookie: better-auth.two_factor=<challenge cookie>; Max-Age=600; Path=/; HttpOnly; SameSite=Lax

{"twoFactorRedirect":true,"twoFactorMethods":["totp"]}
```

Send the code to `POST /v1/auth/two-factor/verify-totp` with that challenge cookie, within ten minutes, to receive the session. Repeated wrong codes lock the account temporarily; that lockout is better-auth's own. `POST /v1/auth/two-factor/disable` with `{"password":"<password>"}` turns it off again.

### Permissions

Authorization is by organization. An operator belongs to organizations as an `owner`, `admin` or `member`, and the session has one active organization (the oldest one they belong to, until they switch). Each route names the permission it needs, and the operator's role in the active organization must hold it. A platform `superadmin` holds every permission and needs no organization.

| Role                          | Holds                                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------------------ |
| Organization `owner`, `admin` | Every permission below                                                                                 |
| Organization `member`         | Every `read`, and `onboarding:review` (the manual review decision and the pending-connector reconcile) |
| Platform `superadmin`         | Every permission below, in any organization or none                                                    |

| Permission          | Routes                                                                          |
| ------------------- | ------------------------------------------------------------------------------- |
| `onboarding:read`   | The onboarding list, one onboarding, its transitions and its agreements         |
| `onboarding:export` | `GET /v1/onboardings/export`                                                    |
| `onboarding:review` | The manual review decision and the pending-connector reconcile                  |
| `workflow:read`     | Workflow and step-type reads, and `POST /v1/admin/workflows/compile`            |
| `workflow:write`    | Creating, editing, deleting and forking drafts, and choosing a step's connector |
| `workflow:publish`  | `POST /v1/admin/workflows/{workflowId}/versions/{version}/publish`              |
| `connector:read`    | The connector settings reads                                                    |
| `connector:write`   | Writing and clearing a connector's settings                                     |
| `encryption:read`   | `GET /v1/admin/encryption`                                                      |
| `encryption:write`  | Turning encryption on or off, rotating keys, creating keys and re-encrypting    |
| `audit:read`        | `GET /v1/admin/audit`                                                           |
| `agreement:read`    | `GET /v1/admin/agreements`                                                      |
| `agreement:write`   | Publishing an agreement version, and linking one to an onboarding               |

### Refusals

A refused request carries a `code` and a `message`:

| Status                    | `code`                     | When                                                                                                                          |
| ------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `401 Unauthorized`        | `ADMIN_SESSION_REQUIRED`   | No session cookie, or it is expired or revoked. Sign in again.                                                                |
| `403 Forbidden`           | `ADMIN_PERMISSION_MISSING` | The role holds no such permission, or the session has no active organization. Signing in again cannot fix this; ask an admin. |
| `503 Service Unavailable` | `AUTH_UNAVAILABLE`         | The engine could not reach its authentication store, so the session was never judged. Retry.                                  |

```json
{ "code": "ADMIN_SESSION_REQUIRED", "message": "Sign in to continue." }
```

```json
{
  "code": "ADMIN_PERMISSION_MISSING",
  "message": "Your account does not have the permission this action needs."
}
```

The sign-in endpoints answer with their own bodies. A wrong password is `401` `{"message":"Invalid email or password","code":"INVALID_EMAIL_OR_PASSWORD"}`. An organization `member` calling `POST /v1/admin/workflows/{workflowId}/versions/{version}/publish` gets `403 ADMIN_PERMISSION_MISSING`, while `GET /v1/admin/connectors` answers `200`. Removing or banning the last active superadmin is refused with `403` `{"code":"LAST_SUPERADMIN","message":"At least one active superadmin must remain."}`.

Every decision, granted or refused, is written to the audit log with the operator's user id, email, platform role and active organization, and the permission a refusal lacked, so the trail answers who read admin data and not only who was turned away. Changes made through the sign-in endpoints themselves (roles, bans, invitations) are not in that trail yet.

:::note Local runs
`ADMIN_AUTH_ENABLED=false` switches the guard off so a fresh clone runs without a session. It is a local-only setting: the engine refuses it when `NODE_ENV=production`.
:::

:::note Examples
The requests and responses above were captured from a local stack run on 2026-11-16 with `ADMIN_AUTH_ENABLED=true`. Secrets are replaced by placeholders in angle brackets.
:::

## Provider callbacks are signed

`POST /v1/webhooks/{providerKey}/callback` is authenticated before anything else happens to the request. The connector adapter declares the recipe (which headers carry the signature and timestamp, the digest algorithm, the encoding, the tolerated clock skew) and the engine verifies it over the raw request body, byte for byte as the provider sent it. The signing secret is a connector setting stored beside the connector's other credentials, never an environment variable.

A refused callback answers `ASYNC_CALLBACK_SIGNATURE_INVALID` with one of two statuses: `401` when the caller is at fault (missing, malformed or mismatched signature, timestamp outside tolerance), `503` when the engine's own configuration is the gap (no signing secret stored, no callback recipe declared). The split matters because providers treat `401` as permanent and stop redelivering; `503` keeps their retry budget alive until an operator closes the gap.

Providers that do not sign at all must be listed in `CONNECTOR_CALLBACK_UNSIGNED_TYPES` before production accepts their callbacks, and a listed connector deserves a network or source-address allowlist in front of the route.
