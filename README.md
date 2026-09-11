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
- **Connectors** — ready-made integrations (Twilio Verify, SendGrid, SMTP, Sumsub) plus a generic
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
pnpm stack:up         # build and start Postgres, Redis, MinIO, MailHog and the engine
pnpm stack:ps         # engine, postgres, redis, minio, mailhog "healthy"; engine-worker just "Up"
```

That gives you the engine and its admin panel on <http://localhost:3000>, a MinIO console on
<http://localhost:9001> and a MailHog inbox on <http://localhost:8025>. The getting-started guide
on the documentation site continues from here.

## What's in the repository

| Path                         | What it is                                                                         |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `packages/engine`            | The service that runs onboardings. Most of the code lives here.                    |
| `packages/shared/ddl-schema` | The workflow file format: its schema, validation and field types.                  |
| `packages/admin-panel`       | The operator UI (React + Vite): onboarding list, audit log and connector settings. |
| `packages/docs`              | The documentation site (Docusaurus).                                               |
| `packages/shared/openapi`    | The engine's OpenAPI document, generated from the code.                            |
| `workflows/`                 | Workflow definitions — `built-in/`, `fixtures/` (examples) and `users/`.           |
| `email-templates/`           | HTML email templates, in the same three scopes.                                    |
| `docs/`                      | Developer documentation.                                                           |

`packages/demo-web`, `packages/demo-bff` and `packages/shared` are placeholders — reserved names with
no application behind them yet.

## Contributing

Contributions are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers the workflow, the checks a
change has to pass, and what to update alongside the code. Everyone taking part is expected to
follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## License

Released under the [MIT License](LICENSE).
