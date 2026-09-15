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
- **An admin panel** — a React app where operators follow onboardings in progress and read the
  audit trail.
- **Connectors** — ready-made integrations (Twilio Verify, SendGrid, SMTP) plus a generic one that
  can call any JSON API from configuration alone, so most providers need no new code.

## Contents

- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [What's in the repository](#whats-in-the-repository)
- [Everyday commands](#everyday-commands)
- [Configuration](#configuration)
- [Extending it](#extending-it)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## How it works

An onboarding is one record: which workflow it follows, which step it is on, and the data collected
so far. The client moves it forward with a single call — the engine validates the submitted data,
calls that step's connectors, decides which transition applies and saves the result.

```
POST /v1/onboardings              start one, from a workflow id
GET  /v1/onboardings/:id/state    what to show the customer right now
POST /v1/onboardings/:id/submit   send this step's answers; the engine advances
```

Manual review, waiting on a slow provider, and finishing are the same shape with different content
— the engine has one kind of step, not a dozen. A step, as the engine runs it, reads like this:

```jsonc
{
  "name": "collect_email",
  "status": "awaiting_user", // what the customer's onboarding looks like while here
  "data": {
    "email": { "type": "text", "required": true, "validation": { "format": "email" } },
  },
  "connectors": [
    {
      "name": "kyc",
      "id": "mock_kyc_1", // the connector this step calls
      "type": "kyc", // what that connector does
      "order": 1,
      "fieldMapping": { "email": "email" },
    },
  ],
  "transitions": [{ "status": "success", "target": "accept_terms" }],
}
```

That is one step, written out by hand as a `custom` step — the step type that carries a step
verbatim, and the way any flow can be spelled out step by step. Writing every step that way gets
repetitive for a real flow, so the same workflow can use **specialized step types** — an address, a
one-time-code check, an identity verification — wired together by their outcomes. Either way the
steps are turned into the one shape the engine runs when the workflow loads; the specialized types
are a shorter way to say the same thing, and the form a drag-and-drop builder works in. The two
built-in revisions of the EEA onboarding are the same flow written both ways: 957 lines of
hand-written steps, or 271 lines of specialized ones.

Two habits are worth knowing up front, because they explain most of what you'll run into:
workflows, connector settings and configuration are **checked when the service starts**, so a
mistake stops the boot rather than surfacing as a failure on someone's onboarding; and a workflow
already in flight never changes shape — publishing a new version leaves existing customers on the
one they started.

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

Stop with `pnpm stack:down`, or `docker compose down -v` to throw the databases away too.

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
| `workflows/`                 | Workflow definitions — `built-in/`, `fixtures/` (examples) and `users/`.           |
| `email-templates/`           | HTML email templates, in the same three scopes.                                    |
| `docs/`                      | Developer documentation.                                                           |

`packages/demo-web`, `packages/demo-bff`, `packages/shared` and `packages/shared/openapi` are
placeholders — reserved names with no application behind them yet.

## Everyday commands

Use the commands at the root of the repository; they wrap Docker, the test runners and the build
with the setup each one needs.

| Command                                       | What it does                                           |
| --------------------------------------------- | ------------------------------------------------------ |
| `pnpm bootstrap`                              | Install dependencies and set up the git hooks          |
| `pnpm stack:up` / `stack:down`                | Start / stop the local stack                           |
| `pnpm stack:ps` / `stack:logs`                | See what is running / follow the logs                  |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | The usual checks                                       |
| `pnpm format:fix`                             | Format everything (the git hook requires this to pass) |
| `pnpm test`                                   | Unit tests                                             |
| `pnpm test:integration`                       | Integration tests (needs Docker)                       |
| `pnpm test:e2e`                               | End-to-end: starts the stack, runs, tears it down      |

## Configuration

Everything is configured through environment variables in `.env`. Start from `.env.dist` — it lists
every variable with a comment explaining what it is for and what it must contain, and it is the
place to look before searching the code.

A fresh copy of `.env.dist` runs locally with no accounts anywhere: emails go to MailHog instead of
a real inbox, the example workflows use stand-in connectors, and the admin panel's sign-in is
switched off so you can open it without an identity provider. Real Twilio and SendGrid credentials
are only needed for the workflows that use those services — though note the engine currently
insists on _something_ being set for them, so leave the placeholders in place.

Operator sign-in for the admin panel uses Microsoft Entra ID and is **on unless explicitly turned
off**, so a deployment that forgets to configure it refuses to serve admin data rather than serving
it to anyone. The two switches are `VITE_AUTH_ENABLED` (the panel) and `ADMIN_AUTH_ENABLED` (the
engine); turning the engine's off is rejected outright in production.

## Extending it

Most of what people want to add needs no engine code:

- **A new onboarding flow** — write a JSON file, drop it in `workflows/users/`, restart.
- **A new provider** — if it speaks JSON over HTTP, describe the call in the workflow's
  configuration using the built-in `http_request` connector.
- **A new email** — add an HTML template under `email-templates/users/`.

When code really is needed — an SDK, a signature scheme, a new field type, a different identity
provider — every extension point is a small, documented interface. See
[docs/EXTENDING.md](docs/EXTENDING.md).

## Documentation

- [docs/EXTENDING.md](docs/EXTENDING.md) — adding workflows, connectors, field types, providers
- [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) — how the system is actually built, section by
  section: the full API, the workflow format, persistence, configuration rules
- [docs/decisions/](docs/decisions/README.md) — why things are the way they are
- [CONTRIBUTING.md](CONTRIBUTING.md) — how to propose a change
- `.env.dist` — every configuration variable, explained inline

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the checks a
change has to pass, and what to update alongside the code. Everyone taking part is expected to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE).
