# 0050. better-auth authenticates admin operators

- **Status:** Accepted
- **Date:** 2026-11-16
- **Tags:** security, admin-panel, api, persistence, configuration
- **Supersedes:** —
- **Superseded by:** —

## Decision

Operators sign in to the admin panel through better-auth, mounted in the engine. It
replaces MSAL in the panel and the `jose`-based Azure JWT guard in the engine.

1. **Microsoft Entra ID stays, as a social provider inside better-auth**, beside email and
   password. It is optional and configured through environment variables.
2. **"Superadmin" is better-auth's `admin` plugin** with a custom platform role
   `superadmin`. Organization roles (`owner`, `admin`, `member`) apply inside an
   organization. A superadmin bypasses the organization check.
3. **An organization groups operators and grants them permissions** on the admin routes.
   Engine data (workflows, onboardings, connectors, audit) stays global: no
   `organization_id` column and no organization filter in any query.
4. **Email and password is invite-only, 2FA is mandatory** (TOTP plus backup codes), and
   the first superadmin is seeded from environment variables at startup. A single
   `databaseHooks.user.create.before` hook refuses to create a user without a pending,
   unexpired invitation for that email, unless the call is server-side (the seed, admin
   `createUser`). It covers email sign-up and Microsoft implicit sign-up.
5. **A Microsoft sign-in counts as satisfying 2FA.** The tenant's Conditional Access
   enforces MFA, not the engine. A user with a `credential` account must have
   `twoFactorEnabled`; a user whose only account is `microsoft` is exempt.

Further choices:

- **Session transport is a cookie, not a bearer token.** The engine serves the panel from
  its own origin (0004), so an httpOnly, `SameSite=Lax` cookie (`Secure` in production)
  works without exposing a token to JavaScript. The `bearer` plugin is not used. CORS
  allows credentials for `ADMIN_PANEL_ORIGIN` only; the cross-origin `pnpm dev` panel on
  `localhost:5173` is same-site with `localhost:3000`.
- **The handler is Nest middleware mounted at `/v1/auth`**, registered in
  `AuthModule.configure()`, not in `main.ts`, so the e2e suites that build the app with
  `Test.createTestingModule` get it too. Every path outside `/v1` serves the panel's
  `index.html`, hence the base path. better-auth needs an unparsed body, so the JSON and
  urlencoded parsers exclude `/v1/auth`, as they already exclude `/v1/webhooks`.
  `@thallesp/nestjs-better-auth` is not used: it registers a global guard that would lock
  the public onboarding flow. Admin routes stay per-route `@AdminRoute(...)`.
- **better-auth's tables live in a Postgres schema named `auth`**, created by a TypeORM
  migration, with better-auth's default camelCase columns. They have no TypeORM entities,
  an exemption from 0027's rule that relations are declared on entities. Foreign keys are
  still added with standalone `ALTER TABLE ... ADD CONSTRAINT`. `better-auth migrate` is
  never run against a database.
- **The ESM-only library is loaded by one module.** better-auth is `"type": "module"` and
  the engine emits CommonJS, so a static `import` or a plain `import()` becomes `require()`
  and fails. `src/auth/better-auth/load-better-auth.ts` is the only module that names the
  `better-auth` specifier, and it loads the package with a dynamic `import()` hidden from
  the TypeScript emitter, `(0, eval)('import(...)')`, with type-only `import type`
  statements erased at build. This is the mechanism `file-type` already uses in
  `src/storage/s3-object-storage.service.ts`. Everything else depends on the
  `ADMIN_SESSION_VERIFIER` port, so unit specs never load better-auth.
- **No impersonation.** The `superadmin` role gets user management (list, create, set
  role, ban, unban, revoke sessions, set password) without `impersonate`. Passkeys, the
  `sso`, `jwt` and `bearer` plugins are not used.

## Context

The admin panel authenticated only through Microsoft Entra ID, with the engine verifying
the Azure JWT. That gave no way to invite an operator outside the tenant, no
per-operator permissions on the admin routes, and no local sign-in. The requester asked for
better-auth with the organization, 2FA and superadmin plugins, keeping Microsoft sign-in.

## Alternatives

| Option                                                    | Why not                                                                                                                                |
| --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Keep MSAL and the Azure JWT guard, add roles to the guard | No local accounts, no invitations, no TOTP; the engine would own all of that code                                                      |
| Bearer tokens through the `bearer` plugin                 | Documented as intended only for APIs without cookie support; the panel is same-origin, and a token in JavaScript is avoidable exposure |
| `@thallesp/nestjs-better-auth`                            | Registers a global `AuthGuard` by default, which would lock the public onboarding flow and the webhooks                                |
| Switch the engine to ESM (`node16` / `nodenext`)          | Every relative import would need a file extension and the whole package would change emitted format for one dependency                 |
| Tenant the engine data by organization                    | Not asked for, and it would touch every table and query; an organization only grants permissions                                       |
| Let `better-auth migrate` create the tables               | Schema changes go through TypeORM migrations only                                                                                      |

## Consequences

The engine gains one runtime dependency and an `auth` schema of better-auth's own tables,
which TypeORM does not model. A future better-auth upgrade that changes its schema needs a
new migration written by hand from the CLI's generated SQL.

`@AdminRoute(...)` carries a permission from one statement set shared with the
organization plugin's access control. Its outcomes are `401` without a session, `403`
`TWO_FACTOR_REQUIRED`, `403` `ADMIN_PERMISSION_MISSING`, and `503` when the auth store is
unreachable. The public onboarding API and `/v1/webhooks` keep their current posture.
`ADMIN_AUTH_ENABLED=false` still lets requests through for local work.

Microsoft sign-ins rely on the tenant's Conditional Access for MFA; an engine deployment
pointed at a tenant without it has no second factor for those operators.

Reversing this means restoring the Azure guard and the panel's MSAL flow and dropping the
`auth` schema; operator accounts and sessions would be lost.
