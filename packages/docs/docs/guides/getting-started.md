---
id: getting-started
title: Getting started
sidebar_label: Getting started
description: From a clean machine to a running engine, admin panel and local providers in five commands.
---

→ Five commands take you from a clone to a running engine with its admin panel, a database, object storage and a local inbox that catches every email. Nothing needs an account anywhere.

## Prerequisites

You need **Node 24**, **pnpm 11** and **Docker**. The repository pins the Node version in `.nvmrc`, so `nvm use` picks it up.

## Bring the stack up

```bash
nvm use
cp .env.dist .env     # do this first: the service reads .env and will not start without it
pnpm bootstrap        # install dependencies, set up the git hooks
pnpm stack:up         # build and start Postgres, Redis, MinIO, MailHog and the engine
pnpm stack:ps         # engine, postgres, redis, minio, mailhog "healthy"; engine-worker just "Up"
```

`.env.dist` is a sample, not a fallback. The engine reads `.env` only, and a missing file fails at start rather than defaulting to something. A fresh copy runs locally with no third-party credentials: emails go to MailHog, the example workflows use stand-in connectors, and the admin panel's sign-in is switched off so you can open it without an identity provider.

## What is running

| Address                                 | What you find there                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `http://localhost:3000`                 | The engine. The API answers under `/v1`; the admin panel answers everywhere else. |
| `http://localhost:3000/v1/health/live`  | The liveness probe.                                                               |
| `http://localhost:3000/v1/openapi.json` | The OpenAPI document this reference is built from.                                |
| `http://localhost:9001`                 | The MinIO console, where uploaded documents land.                                 |
| `http://localhost:8025`                 | The MailHog inbox, catching every outgoing email.                                 |

The panel ships inside the engine's image and is served from the engine's own origin. There is no separate container and no second port to keep in step.

:::tip Ports already taken?
Override the published ports in `.env`: `ENGINE_PORT`, `POSTGRES_PORT`, `REDIS_PORT`, `STORAGE_S3_PORT`, `MINIO_CONSOLE_PORT`, `MAILHOG_HTTP_PORT`. Each changes only what is published to your machine, never what the containers use between themselves. See [Configuration](./configuration.md).
:::

## Working on the admin panel

For hot reload while developing the panel itself, run the Vite dev server alongside the stack. It reaches the engine only from the origin `ADMIN_PANEL_ORIGIN` names, port 5173 by default; otherwise the engine's CORS check rejects its requests.

```bash
pnpm --filter @tsh/admin-panel dev    # http://localhost:5173, with hot reload
```

To keep working at the engine's own address instead, start the stack with the panel-dev overlay. It mounts your built `packages/admin-panel/dist` into the engine, which reads the panel's files from disk on every request, so a rebuild shows up on the next browser refresh with no image rebuild and no container restart:

```bash
pnpm stack:panel-dev:up    # http://localhost:3000, panel served from your own build
pnpm panel:watch           # in a second terminal: rebuild on save, then refresh the browser
```

`pnpm stack:up` recreates the engine without the overlay, which puts it back to serving the copy baked into the image.

## Stopping

```bash
pnpm stack:down          # stop the containers, keep the data
docker compose down -v   # also throw the databases and stored documents away
```

## Everyday commands

Use the commands at the root of the repository. They wrap Docker, the test runners and the build with the setup each one needs, and running the underlying tool by hand produces confusing failures.

| Command                                       | What it does                                        |
| --------------------------------------------- | --------------------------------------------------- |
| `pnpm bootstrap`                              | Install dependencies and set up the git hooks       |
| `pnpm stack:up` / `stack:down`                | Start / stop the local stack                        |
| `pnpm stack:ps` / `stack:logs`                | See what is running / follow the logs               |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | The usual checks                                    |
| `pnpm test`                                   | Unit tests                                          |
| `pnpm test:e2e`                               | End-to-end: starts the stack, runs, tears it down   |
| `pnpm openapi:generate`                       | Regenerate the OpenAPI document after an API change |
| `pnpm docs:dev`                               | This documentation site, with hot reload            |

Next: [your first onboarding](./your-first-onboarding.md).
