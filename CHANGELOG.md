# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

One product version covers the whole monorepo. Every pull request adds its line under
`## Unreleased`; `pnpm version:bump` dates those lines under the new version. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## Unreleased

### Added

- MCP server — `pnpm stack:mcp:up` starts `@tsh/mcp` beside the engine on
  `http://localhost:3100/mcp`. It gives an analyst's AI client 16 tools over the engine's admin API
  — find and explain onboardings, funnel, connector health, review queue, audit search, access
  report, workflow diff — and acts as the signed-in Entra user. Every value is masked before it
  leaves: email and phone become keyed pseudonyms, dates of birth become age bands, and names,
  addresses and free text are withheld.
- MCP write tools — `reconcile_pending_connector` and `create_workflow_draft` change nothing until
  the analyst confirms a preview and the assistant repeats the call with its single-use token. A
  draft is never published. `MCP_WRITE_TOOLS_ENABLED=false` removes both.
- MCP settings — The `MCP_*` variables in `.env.dist`. `MCP_AUTH_ENABLED=false` is refused when
  `NODE_ENV=production`, and the sample `MCP_MASKING_KEY` is a development key published in this
  repository: set a private one (`openssl rand -hex 32`) anywhere else.
- MCP sign-in relay — with sign-in on, the MCP server is its own authorization server and relays to
  Entra (`/oauth/authorize`, `/oauth/token`, `/oauth/register`), dropping the RFC 8707 `resource`
  parameter that made Entra reject Claude Code's sign-in with `AADSTS9010010`. Analysts sign in with no
  client id and no callback port. New `MCP_PUBLIC_CLIENT_ID` (defaults to `MCP_AZURE_CLIENT_ID`);
  `MCP_PUBLIC_URL` must be HTTPS outside localhost. See decision 0054.
- Analyst plugin — `conductor-analyst` installs from this repository's Claude Code and Codex
  marketplaces and adds five skills (`investigating-onboarding`, `triaging-review-queue`,
  `analysing-onboarding-funnel`, `preparing-compliance-evidence`, `reviewing-risk-rules`) and, in
  Claude Code, an `onboarding-investigator` agent.
- Onboarding seeder — `pnpm onboardings:seed` drives the engine's public API to create 46 synthetic
  onboardings (approved, rejected by score or provider, in review, parked, abandoned, duplicate
  applicants) and writes `packages/onboarding-seeder/out/manifest.json`, which says what each one
  demonstrates. `--spread-days <n>` spreads them over the last `n` days.
- Fixture workflow — `analyst-investigation` collects every class of personal data, scores risk,
  verifies an email code and a document, and parks on an identity check until the provider calls
  back. The seeder runs it.
- Skill tooling — `skills:validate` and `skills:evals` cover plugin skills. A golden set can attach
  an MCP server (`mcp_config`), require a tool call (`mcp-tool-called`) and name seeded onboardings
  as `{{manifest:<scenario-key>}}`.

### Changed

- OpenAPI — `pnpm openapi:generate` also regenerates the TypeScript types of the engine API in
  `@tsh/openapi`, and `pnpm test` fails while they are stale.
- Fonts — The commercial TWK Everett files are no longer in the repository and the typeface is no
  longer referenced. The documentation site and the admin panel ship Inter Tight and JetBrains Mono
  (SIL Open Font License) as their only type.

### Fixed

- Docs — The API reference no longer lists an archived 0.1 version while 0.1 is still the current version.

## 0.1.2 — 2026-10-16

### Added

- OTP providers — The engine now generates, hashes and checks one-time codes itself; SMS and
  email providers only deliver them. Two built-in `otp_verification` connectors ship:
  `twilio_sms_otp` (Twilio Programmable Messaging) and `smtp_email_otp` (through the SMTP
  connector). A workflow's `otp-verify` step picks one by id and can fail over to another through
  its `fallback` chain.
- `OTP_DATABASE_POOL_SIZE` — Size of the connection pool the one-time-code checks use, opened
  beside the main pool (default `5`).

### Changed

- **Breaking:** `TWILIO_VERIFY_TIMEOUT_MS` is renamed `OTP_SMS_TIMEOUT_MS`.
- **Breaking:** Connector mocks — `mock_phone_verification` and `mock_email_verification` are
  replaced by one `mock_otp`; update `CONNECTOR_MOCKS` to name `twilio_sms_otp` and
  `smtp_email_otp`, as `.env.dist` does.

### Removed

- **Breaking:** Twilio Verify — The `twilio_verify` connector and its fraud tooling are gone; a
  workflow that names it must switch to `twilio_sms_otp` or `smtp_email_otp`. Per-number
  throttling is not yet replaced.

## 0.1.1 — 2026-10-16

### Added

- Deployment environment name — Every deployment names itself with a required `ENVIRONMENT_NAME`, a
  lowercase slug such as `dev`, `staging`, `pre-prod` or `prod`; the admin panel shows it in its
  sidebar. The name is a label only and changes no behaviour.

### Changed

- `NODE_ENV` is required — It no longer defaults to `development` and must be `development`,
  `production` or `test`; the engine refuses to start otherwise.
- `.env` only — The engine no longer falls back to `.env.dist`; a start without a `.env` fails
  validation instead of booting on the sample's values. Copy it with `cp .env.dist .env`.
- Engine image — The Docker image no longer sets `NODE_ENV=production`; whatever runs it must pass
  `NODE_ENV` and `ENVIRONMENT_NAME`.
- Docker Compose — The engine and worker take `NODE_ENV` and `ENVIRONMENT_NAME` from `.env` and
  refuse to start when either is missing, instead of hard-coding `NODE_ENV=development`.
- Versioning — The version is bumped by hand with `pnpm version:bump`, which also regenerates the
  OpenAPI document and the API reference, instead of on every merge into `main`; every pull request
  adds its own line to this changelog.

## 0.1.0 — 2026-10-13

### Added

- First versioned release — Everything merged into `main` up to this point.
- Workflow engine — JSON workflow definitions stored in the database, with typed steps (form, file
  upload, OTP, terms and conditions, manual review, scoring), conditional validation and
  transitions, and versioned publishing.
- Public onboarding API — Start an onboarding, read its current step schema from `/state`, submit
  step data, and receive state changes through client webhooks.
- Connectors — Sync and async execution, fallback between providers, HMAC verification, and
  adapters for HTTP, SMTP/MailHog, SendGrid, Twilio Verify, Sumsub and Veriff; credentials are set
  up from the admin panel.
- Audit and security — Audit logs for engine decisions, webhooks and error responses, and
  encryption of personal data at rest.
- Admin panel — Azure SSO sign-in, onboarding list and details, audit log with filters, connector
  setup, and workflow list, details and creation.
- Documentation — A Docusaurus site with guides, an API reference generated from the engine's
  OpenAPI document and a gallery of the workflow fixtures.
- OpenAPI document — The engine's HTTP contract is generated from its route and DTO decorators,
  committed, and served at `GET /v1/openapi.json`.
- Agent skills — Claude Code skills for authoring workflows and building BFFs against the engine,
  with golden-set evals.
- Tooling — Docker Compose stack with Garage as the local object store, and the engine image
  bundling the admin panel.
