# TSH Onboarding Conductor

Customer onboarding — identity checks, phone and email verification, document upload, a human
review step — is the same handful of moving parts arranged differently for every product, every
market and every regulator. Conductor makes that arrangement **a JSON file instead of a codebase**.

You describe an onboarding as a list of typed steps: what each one asks the customer for, which
third-party services it calls, and where each outcome leads. The engine runs it, keeps track of
where every customer is, retries and resumes what needs it, and records what happened. Your
front-end asks "what should I show now?" and posts back the answer.

What you get:

- **An engine** — a NestJS service that runs the workflows and exposes a small HTTP API.
- **An admin panel** — a React app where operators follow onboardings in progress, read the
  audit trail and configure connectors.
- **Connectors** — ready-made integrations (Twilio Verify, SendGrid, SMTP, Sumsub, Veriff, Algoan, Lean) plus a generic
  one that can call any JSON API from configuration alone, so most providers need no new code.

## Documentation

The documentation site is where to start: guides that take you from a clean machine to your first
onboarding, the API reference generated from the engine itself, and a gallery of every workflow
that ships with the repository. It lives in [`packages/docs`](packages/docs) and deploys to Vercel;
run it locally with `pnpm docs:dev` on <http://localhost:3030> (the engine keeps 3000).

Developer material stays in the repository:

- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — how the system is actually built, section by
  section: the full API, the workflow format, persistence, configuration rules
- [docs/EXTENDING.md](docs/EXTENDING.md) — adding workflows, connectors, field types, providers
- [docs/decisions/](docs/decisions/README.md) — why things are the way they are
- [packages/shared/openapi/engine.openapi.json](packages/shared/openapi/engine.openapi.json) — the
  OpenAPI document; a running engine serves the same one at `/v1/openapi.json`
- `.env.dist` — every configuration variable, explained inline

## Getting started

You need **Node 24**, **pnpm 11** and **Docker**. Then:

```bash
nvm use
cp .env.dist .env     # do this first — the service reads .env and won't start without it
pnpm bootstrap        # install dependencies, set up the git hooks
pnpm stack:up         # build and start Postgres, Redis, Garage, MailHog and the engine
pnpm stack:ps         # engine, postgres, redis, garage, mailhog "healthy"; engine-worker just "Up"
```

That gives you the engine on <http://localhost:3000>, which serves the admin panel at that same
address, and a MailHog inbox catching every outgoing email on <http://localhost:8025>. Nothing
needs to run outside the stack.

The panel ships inside the engine's image and is served from the engine's own origin: the API
answers under `/v1`, the panel answers everywhere else. There is no separate container and no
second port to keep in step.

For hot reload while developing the panel itself, run the Vite dev server alongside the stack.
It reaches the engine only from the origin `ADMIN_PANEL_ORIGIN` names (5173 by default);
otherwise the engine's CORS check rejects its requests:

```bash
pnpm --filter @tsh/admin-panel dev    # http://localhost:5173, with hot reload
```

To keep working at the engine's own address instead, start the stack with the
`docker-compose.panel-dev.yml` overlay. It mounts your built `packages/admin-panel/dist` into the
engine, which reads the panel's files from disk on every request, so a rebuild shows up on the next
browser refresh — no image rebuild and no container restart:

```bash
pnpm stack:panel-dev:up    # http://localhost:3000, panel served from your own build
```

Leave a rebuild running in a second terminal, and refresh the browser after each save:

```bash
pnpm panel:watch
```

`pnpm stack:up` recreates the engine without the overlay, which puts it back to serving the copy
baked into the image.

If a port is already taken on your machine, override it in `.env` (`ENGINE_PORT`, `POSTGRES_PORT`,
`REDIS_PORT`, `STORAGE_S3_PORT`, `MAILHOG_HTTP_PORT`) — that changes only
what is published to your machine, never what the containers use between themselves.

Stop with `pnpm stack:down`, or `pnpm stack:reset` to throw the databases away too. A stack created
before the migration set was folded in September 2026 needs that reset once: its `migrations` table
already lists the folded numbers, so the rewritten `CREATE TABLE`s never run and the engine exits at
boot.

### Your first onboarding

The `base` example workflow ships with the repository, so there is something to run immediately.
The responses below are from a real local run:

```bash
$ curl -X POST localhost:3000/v1/onboardings \
    -H 'Content-Type: application/json' -d '{"workflowId":"base"}'
{"onboardingId":"01a023ea-bf9e-772d-9f5a-f49b33b3dd1a","status":"awaiting_user",
 "currentStep":"collect_email","expiresAt":null}

$ curl localhost:3000/v1/onboardings/01a023ea-.../state
… "step": { "name": "collect_email", "canSubmit": true, "fields": [
     { "name": "email", "type": "text", "required": true, "value": null,
       "schema": { "type": "string", "format": "email" } } ] }

$ curl -X POST localhost:3000/v1/onboardings/01a023ea-.../submit \
    -H 'Content-Type: application/json' -d '{"email":"person@example.com"}'
{"appliedStep":"collect_email","status":"awaiting_user",
 "currentStep":"accept_terms","rejectionReason":null}
```

You send exactly the fields the current step declares. Anything missing, unknown or malformed comes
back as `400` with a per-field explanation, and the onboarding stays where it was:

```bash
$ curl -X POST localhost:3000/v1/onboardings/01a023ea-.../submit \
    -H 'Content-Type: application/json' -d '{"acceptedTerms":"yes"}'
{"code":"INVALID_STEP_DATA","message":"INVALID_STEP_DATA","errors":{"acceptedTerms":["INVALID"]}}
```

The rest of the API — documents, manual review, provider callbacks, the admin endpoints — is listed
in [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md).

## What's in the repository

| Path                         | What it is                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `packages/engine`            | The service that runs onboardings. Most of the code lives here.                    |
| `packages/shared/ddl-schema` | The workflow file format: its schema, validation and field types.                  |
| `packages/admin-panel`       | The operator UI (React + Vite): onboarding list, audit log and connector settings. |
| `packages/docs`              | The documentation site (Docusaurus).                                               |
| `packages/demo-bff`          | The BNPL credit-check demo's backend-for-frontend (NestJS).                        |
| `packages/demo-web`          | The BNPL credit-check demo's web app (React + Vite); `pnpm demo:dev` runs both.    |
| `packages/shared/openapi`    | The engine's OpenAPI document, generated from the code.                            |
| `workflows/`                 | Workflow definitions — `built-in/`, `fixtures/` (examples) and `users/`.           |
| `email-templates/`           | HTML email templates, in the same three scopes.                                    |
| `docs/`                      | Developer documentation.                                                           |

`packages/shared` is a placeholder — a reserved name with no application behind it yet.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the checks a
change has to pass, and what to update alongside the code. Everyone taking part is expected to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE).
