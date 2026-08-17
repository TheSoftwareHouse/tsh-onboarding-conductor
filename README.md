# TSH Onboarding Conductor

Onboarding Orchestrator Monorepo.

## Quickstart

### Prerequisites

- Node.js 20.x (use \`nvm use\`)
- pnpm 11.x
- Docker & Docker Compose

### Local Stack

Copy the sample environment file before starting the stack:

```bash
cp .env.dist .env
```

Required env vars live in `.env.dist` and should remain aligned with the compose stack:

- `MODE`
- `PORT`
- `NODE_ENV`
- `WORKFLOWS_DIR`
- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_DRIVER`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_REGION`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_FORCE_PATH_STYLE`
- `STORAGE_S3_ACCESS_KEY_ID`
- `STORAGE_S3_SECRET_ACCESS_KEY`

### Changing the Host Postgres Port

The `postgres` service publishes its port to the host as
`${POSTGRES_PORT:-5432}:5432`, so it binds host port `5432` by default. If
port `5432` is already taken on your machine, set `POSTGRES_PORT` in `.env` to
a free host port, for example:

```bash
POSTGRES_PORT=5433
```

This only remaps the host-side port. Inside the Compose network, the `engine`
service always reaches Postgres at `postgres:5432`, so its `DATABASE_URL`
stays `postgres://orchestrator:orchestrator_pass@postgres:5432/orchestrator?sslmode=disable`
and does not need to change. If you also run the engine directly on the host
(outside Compose), update the port in your `.env`'s `DATABASE_URL` (which
targets `localhost`) to match your chosen `POSTGRES_PORT`.

### Changing the Host Redis Port

The `redis` service publishes its port to the host as
`${REDIS_PORT:-6379}:6379`, so it binds host port `6379` by default. If port
`6379` is already taken on your machine, set `REDIS_PORT` in `.env` to a free
host port, for example:

```bash
REDIS_PORT=6380
```

This only remaps the host-side port. Inside the Compose network, the `engine`
service always reaches Redis at `redis:6379`, so its `REDIS_URL` stays
`redis://redis:6379/0` and does not need to change. If you also run the
engine directly on the host (outside Compose), update the port in your
`.env`'s `REDIS_URL` (which targets `localhost`) to match your chosen
`REDIS_PORT`.

### Changing the Host MinIO API Port

The `minio` service publishes its API port to the host as
`${STORAGE_S3_PORT:-9000}:9000`, so it binds host port `9000` by default. If
port `9000` is already taken on your machine, set `STORAGE_S3_PORT` in `.env`
to a free host port, for example:

```bash
STORAGE_S3_PORT=9002
```

This only remaps the host-side port. Inside the Compose network, the `engine`
service and `minio-init` always reach MinIO at `http://minio:9000`, so
`STORAGE_S3_ENDPOINT` used by the engine container stays `http://minio:9000`
and does not need to change. If you also access MinIO directly on the host
(outside Compose), update the port in your `.env`'s `STORAGE_S3_ENDPOINT`
(which targets `localhost`) to match your chosen `STORAGE_S3_PORT`.

### Changing the Host MinIO Console Port

The `minio` service publishes its web console port to the host as
`${MINIO_CONSOLE_PORT:-9001}:9001`, so it binds host port `9001` by default.
If port `9001` is already taken on your machine, set `MINIO_CONSOLE_PORT` in
`.env` to a free host port, for example:

```bash
MINIO_CONSOLE_PORT=9003
```

The console is a direct-host-only convenience UI with no Compose-network
consumer, so only your browser URL changes: visit
`http://localhost:9003` (substituting your chosen `MINIO_CONSOLE_PORT`) to
reach it.

### Changing the Host Engine Port

The `engine` service publishes its port to the host as
`${ENGINE_PORT:-3000}:3000`, so it binds host port `3000` by default. If port
`3000` is already taken on your machine, set `ENGINE_PORT` in `.env` to a
free host port, for example:

```bash
ENGINE_PORT=3001
```

This only remaps the host-side port. The engine container's application
listener, `PORT: ${PORT:-3000}`, its container target port `3000`, and its
healthcheck `http://127.0.0.1:3000/v1/health/live` all stay unchanged.
Direct host/browser access follows your chosen `ENGINE_PORT`, for example
`http://localhost:3001`, instead of the default `http://localhost:3000`.

### Workflow Directory

`WORKFLOWS_DIR` is required. For direct host execution, the distributed value
`./workflows` points to the repository root's `workflows/` directory, which
contains the checked-in example workflow.

When the engine runs through Compose, the `engine` service sets
`WORKFLOWS_DIR=/app/workflows` and mounts the host `./workflows` directory at
that path read-only. The engine discovers only `.json` files directly inside
the configured directory at startup. It does not recurse into subdirectories
or load other file formats.

Startup fails when the configured directory is missing, unreadable, not a
directory, empty of direct JSON workflow files, or contains malformed or
invalid workflow definitions. Duplicate workflow IDs also fail startup,
including duplicates that use different versions.

To run custom workflows with Compose, keep the container path and replace the
host source in a local Compose override. For example, save this as
`docker-compose.override.yml` and change the host path:

```yaml
services:
  engine:
    volumes:
      - /absolute/path/to/custom-workflows:/app/workflows:ro
```

The override supplies the custom host directory read-only at the same
`/app/workflows` path. This documents the local Compose workflow source model;
direct non-Compose deployment configuration is outside this repository's
scope.

The local stack uses Postgres, Redis, and MinIO. The engine expects S3-compatible storage, and the `minio-init` service creates the `orchestrator-files` bucket before the engine is treated as ready.

The checked-in workflow examples in `workflows/` include `manual-smtp.workflow.json`, which is a manual/local-development example for sending a message to a local MailHog instance. It keeps the HTML body in connector configuration and supplies template variables through mapped workflow fields. It is intentionally minimal and is not a production workflow.

### Setup

1. **Bootstrap the workspace:**

   ```bash
   pnpm bootstrap
   ```

   This installs dependencies from the lockfile and prepares the local Husky hooks.

2. **Validate the compose file:**

   ```bash
   pnpm stack:config
   ```

3. **Start the local stack:**

   ```bash
   pnpm stack:up
   ```

4. **Run the repository e2e suite:**

   ```bash
   pnpm test:e2e
   ```

   This command starts the compose stack, runs the workspace e2e suites, and tears the stack down afterward.

5. **Verify services and bootstrap:**

   ```bash
   pnpm stack:ps
   docker compose logs minio-init --tail=40
   ```

6. **Stop the stack when you are done:**
   ```bash
   pnpm stack:down
   ```

If you need to fully reset local state, run `docker compose down -v` to remove the Postgres, Redis, and MinIO volumes as well.

### MinIO Bootstrap Expectations

- MinIO listens on ports `9000` and `9001`.
- `minio-init` waits for MinIO to become healthy, then creates the `orchestrator-files` bucket.
- The engine uses `STORAGE_DRIVER=s3` and points at the MinIO endpoint defined in `.env.dist`.
- A healthy local stack should show `postgres`, `redis`, `minio`, and `engine` as healthy, with `minio-init` exited successfully.

## Admin Panel Authentication

The admin panel signs operators in against Microsoft Entra ID and sends the resulting access
token to the engine, which verifies it on `GET /v1/onboardings` and `GET /v1/admin/audit`. The
panel is a browser public client using the OAuth 2.0 authorization code flow with PKCE, so there
is no client secret anywhere in this repository. The end-user onboarding endpoints
(`POST /v1/onboardings…`), the webhook callbacks, and the health endpoint stay unauthenticated.

Local development works without a tenant: `.env.dist` ships `VITE_AUTH_ENABLED=false` and
`ADMIN_AUTH_ENABLED=false`. Both default to enabled when unset, so a deployed environment that
forgets to configure them is gated rather than open.

### App Registrations

Two registrations are needed in the Entra tenant.

1. **Engine API.** Under _Expose an API_, set the Application ID URI to
   `api://<engine-client-id>` and add a scope named `Onboardings.Read`. In the manifest, set
   `"accessTokenAcceptedVersion": 2`. Without it Entra issues v1.0 tokens whose issuer is
   `https://sts.windows.net/...`, which the engine rejects.
2. **Admin panel SPA.** Add a **Single-page application** platform (not _Web_) — this is what
   lets Entra accept PKCE without a secret and return CORS headers from the token endpoint.
   Register the redirect URI exactly as configured, defaulting to the panel's own origin
   (`http://localhost:5173/` locally). Under _API permissions_, add the engine's
   `Onboardings.Read` delegated scope and grant admin consent.

### App Roles

Authorization is by Entra **app role**. The tenant defines `admin`, `compliance`, and `auditor`;
only `admin` may currently read admin data. Under _App roles_ on the registration, each role's
**Value** is what lands in the token's `roles` claim — use that, not the display name.

Assign operators under **Enterprise applications** → this app → _Users and groups_. Entra emits
the `roles` claim only for roles a user is actually assigned, so an unassigned account gets a
perfectly valid token with no roles and is refused. Enabling **Assignment required** on the
enterprise application additionally blocks sign-in itself.

A token that verifies but carries none of the allowed roles is rejected with **403**, not 401 —
signing in again cannot fix it. Widening access later is a config change, not a code change:
`ADMIN_REQUIRED_ROLES=admin,auditor`.

### Configuration

| Variable                  | Side   | Required when      | Notes                                                                                                                                     |
| ------------------------- | ------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_AUTH_ENABLED`       | panel  | —                  | Sign-in is on unless explicitly `false`.                                                                                                  |
| `VITE_AZURE_CLIENT_ID`    | panel  | sign-in enabled    | Panel SPA registration client id.                                                                                                         |
| `VITE_AZURE_TENANT_ID`    | panel  | sign-in enabled    | Concrete directory id.                                                                                                                    |
| `VITE_AZURE_API_SCOPE`    | panel  | sign-in enabled    | Either a named scope (`api://<engine-client-id>/Onboardings.Read`, requires _Expose an API_) or `<engine-client-id>/.default`. See below. |
| `VITE_AZURE_REDIRECT_URI` | panel  | optional           | Defaults to the panel's origin.                                                                                                           |
| `ADMIN_AUTH_ENABLED`      | engine | —                  | Verification is on unless explicitly `false`.                                                                                             |
| `AZURE_TENANT_ID`         | engine | admin auth enabled | Rejected if `common` or `organizations`, because the accepted issuer is pinned to it.                                                     |
| `AZURE_API_AUDIENCE`      | engine | admin auth enabled | The engine registration's **client id GUID**, not the `api://` URI.                                                                       |
| `ADMIN_REQUIRED_ROLES`    | engine | admin auth enabled | Comma-separated app roles allowed to read admin data; defaults to `admin`. Matched case-insensitively against the token's `roles` claim.  |

### Choosing the Requested Scope

The engine authorizes on the `roles` claim and deliberately does not inspect `scp`, so the panel
has two workable options:

- **`<engine-client-id>/.default`** — asks for whatever is statically configured instead of a
  named scope. No Application ID URI and no exposed scope are needed, which removes the
  _Expose an API_ setup entirely. The token still carries `aud = <engine-client-id>` and the
  `roles` claim, which is everything the engine checks.
- **`api://<engine-client-id>/Onboardings.Read`** — the textbook OAuth shape. Requires setting the
  Application ID URI and adding the scope under _Expose an API_, and the URI must match the
  configured value character-for-character.

Neither avoids the app-role work: `roles` is emitted only for roles that are both defined on the
registration and assigned to the signed-in user.

The accepted issuer (`https://login.microsoftonline.com/<tenant>/v2.0`) and the JWKS URL are
derived from `AZURE_TENANT_ID` and are never configured directly. Because the panel now sends an
`Authorization` header, every admin request is preceded by a CORS preflight; the engine allows
that header for the configured `ADMIN_PANEL_ORIGIN` only.

### What Each Rejection Means

| Status | Meaning                                                                                         | What the operator should do     |
| ------ | ----------------------------------------------------------------------------------------------- | ------------------------------- |
| `401`  | The token was read and found wanting: absent, expired, wrong issuer or audience, bad signature. | Sign in again.                  |
| `403`  | The token verified, but its `roles` claim holds none of `ADMIN_REQUIRED_ROLES`.                 | Ask for an app role assignment. |
| `503`  | The signing key set could not be fetched, so the token was never judged at all.                 | Retry; the session is fine.     |

The 401/503 split matters operationally. A JWKS timeout, a refused connection, or a non-200 from
Entra's key endpoint is an engine-side fault, and reporting it as a bad credential would send
every operator off to re-authenticate over a network problem. The server log distinguishes the
two: `AUTH_TOKEN_REJECTED` for a bad token, `AUTH_VERIFICATION_UNAVAILABLE` for an outage.

An unrecognized `kid` stays a 401 rather than a 503, even though it can mean a key rotation the
cache has not picked up yet, because it is also the ordinary shape of a forged token — treating
it as an outage would let any caller provoke a 503 at will.

### Audit Trail

Every access decision on an admin endpoint is written to `audit_log` and is readable through
`GET /v1/admin/audit` like any other event. Successes are recorded as well as refusals: the
question an auditor usually asks is "who read this data", and only the success rows answer it.

| Action                          | Actor       | Written when                                                          |
| ------------------------------- | ----------- | --------------------------------------------------------------------- |
| `auth.access_granted`           | `operator`  | A verified operator with an allowed role read the endpoint.           |
| `auth.token_rejected`           | `anonymous` | The credential was absent or unacceptable (401).                      |
| `auth.role_missing`             | `operator`  | The token verified but carried none of `ADMIN_REQUIRED_ROLES` (403).  |
| `auth.verification_unavailable` | `anonymous` | Entra's key set was unreachable, so the token was never judged (503). |
| `auth.access_unauthenticated`   | `anonymous` | `ADMIN_AUTH_ENABLED=false` served admin data with no credential.      |

The `auth.` prefix names the subsystem that emitted the event, matching how `webhook.` groups
events from the webhook flow; which surface the decision concerned is carried by the resource
columns instead. Where a decision is logged as well as audited, the log event is the upper-snake
form of the action — `AUTH_TOKEN_REJECTED` for `auth.token_rejected`, `AUTH_ROLE_MISSING` for
`auth.role_missing` — so an operator reading the logs can query the matching rows with
`?action=auth.token_rejected` and no translation table. Successes are audited only.

`resource_type` is always `admin_endpoint` and `resource_id` is the route (`/v1/onboardings`),
so `GET /v1/admin/audit?resourceType=admin_endpoint&resourceId=/v1/onboardings` returns the full
read history for one endpoint, and `?actorId=<oid>` returns everything one operator touched.

`actor_id` is the token's `oid` — Entra's immutable per-directory user id — because a user
principal name can be reassigned to a different person. The UPN is recorded alongside it in
`metadata.userPrincipalName` for whoever reads the trail, together with `tenantId` and the roles
the token actually carried. A refusal never carries operator fields: nothing about the caller was
established, and empty fields would read as though something had been. Rejected tokens instead
record the unverified `tokenIssuer` / `tokenAudience` / `tokenVersion`, which is what
distinguishes a misconfigured app registration from a forged credential.

The query string is deliberately not recorded — admin filters can carry the very identifiers the
trail exists to protect.

Auditing is **best effort**: a failed write is reported as `AUTH_AUDIT_WRITE_FAILED` on the
engine's logger but never turns into a failed request, so a database outage cannot take the admin
endpoints down with it. The trade is a gap in the trail during such an outage, which that log
line makes visible.

`auth.access_unauthenticated` should never appear in a deployed environment. Its presence in the
trail means admin data was served without a credential being demanded, and is itself the finding.

## Architecture & Layout

Conformant with the \`SPEC.md\` architecture and CQRS patterns.
See the \`ONBOARDING_SPEC/\` directory for detailed requirements.
