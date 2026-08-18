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
- `BUILTIN_WORKFLOWS_DIR`
- `FIXTURE_WORKFLOWS_DIR`
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

### Workflow Sources

The engine loads workflows from three independent sources and merges them into
one registry:

| Source       | Setting                 | Loaded in          | May be empty |
| ------------ | ----------------------- | ------------------ | ------------ |
| **built-in** | `BUILTIN_WORKFLOWS_DIR` | all environments   | yes          |
| **user**     | `WORKFLOWS_DIR`         | all environments   | no, if set   |
| **fixtures** | `FIXTURE_WORKFLOWS_DIR` | development & test | no, if set   |

**Built-in** workflows are production-grade and ship inside the engine image at
`packages/engine/workflows/built-in`. **The repository ships none yet**, which
is why this is the one source allowed to be absent or empty.

**User** workflows are yours, normally supplied as a mounted volume. Unset by
default.

**Fixture** workflows live at `packages/engine/workflows/fixtures` and exist to
exercise the engine — each demonstrates one connector or one engine feature, and
several drive sandbox connectors. `AppConfig` refuses `FIXTURE_WORKFLOWS_DIR`
when `NODE_ENV=production`, so a production engine cannot load them by accident.
The unit and e2e suites read this directory directly.

All three are set for you in the Compose stack. To add your own workflows, point
`WORKFLOWS_DIR` at a directory and mount it — for example in a
`docker-compose.override.yml`:

```yaml
services:
  engine:
    environment:
      WORKFLOWS_DIR: /app/workflows
    volumes:
      - /absolute/path/to/your-workflows:/app/workflows:ro
```

To run _only_ your own workflows, also clear `FIXTURE_WORKFLOWS_DIR` (set it to
an empty value) so the fixtures are not merged in alongside them.

Within each directory the engine discovers only `.json` files directly inside
it. It does not recurse into subdirectories or load other file formats.

Startup fails when a configured directory is unreadable, is not a directory,
contains malformed or invalid workflow definitions, or — for the user and
fixture sources — holds no workflow files at all. It also fails when the three
sources between them produce no workflows, when one directory declares the same
workflow ID twice, or when two sources declare the same ID; the last of these
names both sources in the error.

The local stack uses Postgres, Redis, and MinIO. The engine expects S3-compatible storage, and the `minio-init` service creates the `orchestrator-files` bucket before the engine is treated as ready.

The fixture workflows include `manual-smtp.workflow.json`, which exercises the `smtp_email` connector. That connector speaks plain SMTP against whatever server `SMTP_HOST`/`SMTP_PORT` point at, with optional STARTTLS/implicit TLS and authentication; MailHog is only the sink the local stack and CI happen to point it at. The workflow itself keeps the HTML body in connector configuration and supplies template variables through mapped workflow fields.

### Connector Tiers

Every connector adapter declares a `tier`:

- **`production`** — talks to a real provider: `http_request`, `sendgrid_email`,
  `smtp_email`, `twilio_verify`. Lives in
  `packages/engine/src/connectors/adapters/production/` and is always registered.
- **`sandbox`** — fakes its provider: the `mock_*` types. Lives in
  `adapters/sandbox/` and is registered **only** when
  `SANDBOX_CONNECTORS_ENABLED=true`.

`AppConfig` refuses to start when `SANDBOX_CONNECTORS_ENABLED` is set under
`NODE_ENV=production`, and an ESLint boundary stops anything outside
`ConnectorsModule` from importing a sandbox adapter directly.

The tier is a required field on `ConnectorAdapter`, so a new connector cannot
be added without choosing a side. `ConnectorsModule` additionally fails startup
if an adapter is registered in a list that disagrees with the tier it declares.

Because a workflow's connector declarations are validated while the registry
loads, an engine without the sandbox tier enabled **fails at startup** when a
workflow references a `mock_*` type — it does not fail later on the first
applicant to reach that step.

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
