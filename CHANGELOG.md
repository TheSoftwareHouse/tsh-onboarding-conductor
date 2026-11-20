# Changelog

All notable changes to this project are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

One product version covers the whole monorepo. Every pull request adds its line under
`## Unreleased`; `pnpm version:bump` dates those lines under the new version. See
[CONTRIBUTING.md](CONTRIBUTING.md#versioning).

## Unreleased

### Added

- Graph workflow editor — The admin panel's draft editor has an Authored graph tab: add steps from a
  palette, wire ports, edit each step's config in a generated form, drag steps (saved as
  `meta.position`) and undo or redo, saving the same document the JSON tab edits. A stored version
  opens the same canvas read-only. Fields get a validation editor per type and can be renamed, with
  references following; an HTTP call's request is a form; unclear settings carry a hint; every
  problem a step has is listed in full, on the canvas and in its inspector. The compiled graph's
  inspector names the authored step a compiled step came from. A step's scoring rules are edited in
  its inspector, and its node lists the scores they touch; a condition picks its score from the ones the workflow declares, and a field name in a condition or setting is suggested from the fields the workflow stores. A setting that fails its step type's
  schema shows a short reason under it, and the step's problem names the setting instead of a bare
  error code. A consent — a `consents` section's acknowledgement, or a yes/no field of a custom
  step — is tracked as an agreement from its step, and Workflow settings lists every agreement with
  its step and field picked from those consents. The details header keeps the version picker and a
  draft's actions on the right, stacked, with the title wrapping on the left. The compiled graph routes
  and labels its edges the way the Authored graph does, and dashes only loops back. A connector
  fallback offers only connectors of the primary's type, and changing the primary's type clears the
  connector ids it no longer fits. A custom step's transitions are edited under Ports — added,
  removed, reordered, with their status, condition and reason — instead of deep in its settings. Each inspector section's title stays pinned while the section scrolls. The inspector's labels, add and remove buttons, list entries and empty values follow one
  style across every section. Card titles, field labels and secondary text read as three distinct levels. List entries are white cards and named groups of settings, such as
  Validation, sit on a tinted panel, so a form's structure shows at a glance.
- Forking under a new ID — The admin panel renames the copy's connector `sourceKey`s from the new
  workflow ID, so the fork no longer fails its first publish with `WORKFLOW_SOURCE_KEY_CONFLICT`.
- Unsaved-changes guard — Leaving a workflow draft with unsaved edits, for another page or another
  version, now asks first; a reload or closing the tab gets the browser's own prompt.
- Release — CI creates an annotated `vX.Y.Z` tag on a merged `release/X.Y.Z` pull request's merge
  commit and a GitHub Release with that version's changelog section as notes; run by hand with the
  release commit, it finishes a release whose run failed. `pnpm release:check` fails a pull request
  that changes the version outside a release branch, lowers it, lacks its changelog section, or
  leaves a line under `## Unreleased`.

### Changed

- Admin panel — The Onboardings Workflow and Workflow version filters are pickers fed by the engine's workflow lists instead of text fields; the version is cleared when the workflow changes.
- Admin panel — Filter selects (Onboardings, Workflows, Logs) use the panel's own `Select` instead of the browser's native select.
- **Breaking:** Admin authentication — Operators now sign in through better-auth, built into the
  engine, instead of Microsoft Entra ID bearer tokens. Admin routes (`/v1/admin/*`, the operator
  reads, export and agreement link on `/v1/onboardings`, the pending-connector reconcile and the
  manual review decision) need a better-auth session cookie, not an `Authorization: Bearer` header,
  and a caller that sends only a token gets `401 ADMIN_SESSION_REQUIRED`. Each route also needs a
  permission (`onboarding:read`, `workflow:publish`, `connector:write` and so on) held by the
  operator's role in their active organization, or the platform `superadmin` role; a role without
  it gets `403 ADMIN_PERMISSION_MISSING`. Two-factor authentication (TOTP) is optional: each
  operator turns it on or off on the panel's new Account page, and an operator who has it is asked
  for a code at sign-in. Accounts are by invitation only, and the first
  superadmin is seeded from `AUTH_SUPERADMIN_EMAIL` and `AUTH_SUPERADMIN_PASSWORD`. A BFF or script
  that used an Entra client-credentials token needs an operator account instead; there is no API
  key. Removed: `ADMIN_SSO_PROVIDER`, `AZURE_TENANT_ID`, `AZURE_API_AUDIENCE`,
  `ADMIN_REQUIRED_ROLES`, `VITE_SSO_PROVIDER`, `VITE_AZURE_CLIENT_ID`, `VITE_AZURE_TENANT_ID`,
  `VITE_AZURE_API_SCOPE` and `VITE_AZURE_REDIRECT_URI`. Added, required while
  `ADMIN_AUTH_ENABLED=true`: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `AUTH_SMTP_URL` and
  `AUTH_MAIL_FROM`; optional: `AUTH_SUPERADMIN_EMAIL`, `AUTH_SUPERADMIN_PASSWORD` and the Microsoft
  triple `AUTH_MICROSOFT_CLIENT_ID`, `AUTH_MICROSOFT_CLIENT_SECRET`, `AUTH_MICROSOFT_TENANT_ID`.
  Microsoft sign-in is now optional and skips the engine's TOTP step, so require MFA in the tenant.
  Migration `0003` creates the `auth` schema; the audit actions `auth.token_rejected` and
  `auth.role_missing` are replaced by `auth.session_missing` and `auth.permission_missing`, and the audit identity is now `userId`, `email`, `platformRole` and
  `organizationId`. The manual review route, which was open until 2026-11-01, is part of this
  surface. CORS now allows credentials and `POST`, and no longer allows `Authorization`.
- Admin panel — Every page shows loading, error and empty states through one set of components:
  a spinner that appears after 150 ms, "Unable to load …" with Retry, "No access to …", not-found
  pages with a link back, and empty and no-match messages under the table's column headers.
- Compiled workflow graph — The tab formerly named Graph is Compiled graph (`?view=graph` still
  opens it) and draws a dashed frame around the compiled steps one authored step produced.
- Workflow validation — A failure in one step's connector field mappings, conditions, scoring or
  transitions now carries that step's `path` (`steps[i]`) instead of none, so the admin panel and
  `pnpm workflow:compile` name the step to fix.
- Release — `pnpm version:bump` refuses to run on any branch but `release/X.Y.Z` for the version it
  computes.
- Fonts — The commercial TWK Everett files are no longer in the repository and the typeface is no
  longer referenced. The documentation site and the admin panel ship Inter Tight and JetBrains Mono
  (SIL Open Font License) as their only type.
- Tooling — `.claude/settings.local.json` is no longer tracked and is git-ignored, so each person's
  local Claude Code settings stay on their machine. `tsh-product-design`, the one plugin it enabled,
  moved to the shared `.claude/settings.json`.

### Fixed

- **Security:** Admin authentication — An email sign-up must send the id of the invitation mailed
  to its address (`invitationId`); knowing an invitee's address is no longer enough to register it
  first and accept the invitation as them. The panel's invitation page sends it, and the account
  starts with a verified email.
- **Security:** Engine — An admin write (anything but `GET`, `HEAD` or `OPTIONS`) whose `Origin` is
  neither `ADMIN_PANEL_ORIGIN` nor the engine's own is refused with `403 ADMIN_ORIGIN_REFUSED` and
  audited as `auth.origin_refused`, so a page elsewhere on the same site cannot forge one with the
  `SameSite=Lax` session cookie. A request without `Origin` is not a browser's and is judged by its
  session as before.
- Admin authentication — The invitation email links to the panel the inviter used, so it works
  when the panel runs apart from the engine (`pnpm dev`), and a failed password-reset email is
  logged as `AUTH_PASSWORD_RESET_MAIL_FAILED` instead of disappearing.
- Admin panel — Cached reads no longer outlive the session that fetched them. Signing out, a
  session that expires or is revoked, or a sign-out in another tab clears the cache; another
  operator, a changed platform role or a switch of the active organization resets every query, and
  the organization switcher reloads its list. A `401` from any read or write drops the reads not on
  screen and re-reads the session, so a lost session returns to the sign-in form. Before, the next
  operator could see the previous one's data.
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
