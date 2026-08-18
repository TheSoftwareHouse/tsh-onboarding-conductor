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

`WORKFLOWS_DIR` is required and is expected to point at workflows you own.
**This repository ships no production workflows.** Everything under
`examples/workflows/` is a demonstration of a single connector or engine
feature — several of them drive sandbox connectors that only exist for local
development, and `http-request.workflow.json` posts to the reserved
placeholder host `api.example.com`. Treat them as documentation, not as a
starting deployment.

The engine's own end-to-end suite does not read `examples/workflows/`; it owns
a frozen copy under `packages/engine/test/fixtures/workflows/`, so the
examples can change without breaking tests and vice versa.

When the engine runs through Compose, the `engine` service sets
`WORKFLOWS_DIR=/app/workflows` and mounts the host `./examples/workflows`
directory at that path read-only, which is a local-development convenience.
The engine discovers only `.json` files directly inside the configured
directory at startup. It does not recurse into subdirectories or load other
file formats.

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

The checked-in workflow examples in `examples/workflows/` include `manual-smtp.workflow.json`, which exercises the `smtp_email` connector. That connector speaks plain SMTP against whatever server `SMTP_HOST`/`SMTP_PORT` point at, with optional STARTTLS/implicit TLS and authentication; MailHog is only the sink the local stack and CI happen to point it at. The workflow itself keeps the HTML body in connector configuration and supplies template variables through mapped workflow fields. It is intentionally minimal and is not a production workflow.

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

## Architecture & Layout

Conformant with the \`SPEC.md\` architecture and CQRS patterns.
See the \`ONBOARDING_SPEC/\` directory for detailed requirements.
