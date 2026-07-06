# TSH Onboarding Conductor

Onboarding Orchestrator Monorepo.

## Quickstart

### Prerequisites

- Node.js 20.x (use \`nvm use\`)
- pnpm 9.x
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
- `DATABASE_URL`
- `REDIS_URL`
- `STORAGE_DRIVER`
- `STORAGE_S3_BUCKET`
- `STORAGE_S3_REGION`
- `STORAGE_S3_ENDPOINT`
- `STORAGE_S3_FORCE_PATH_STYLE`
- `STORAGE_S3_ACCESS_KEY_ID`
- `STORAGE_S3_SECRET_ACCESS_KEY`

The local stack uses Postgres, Redis, and MinIO. The engine expects S3-compatible storage, and the `minio-init` service creates the `orchestrator-files` bucket before the engine is treated as ready.

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
