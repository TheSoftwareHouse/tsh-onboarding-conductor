# Extending the engine

Most extension happens in JSON rather than TypeScript. Reach for code only when the declarative
route genuinely cannot express what you need — the engine deliberately has no connector categories
and no step types, so there is less to hook into than you might expect.

This document assumes you have the local stack running; see the [README](../README.md).

## Contents

- [Definition scopes: built-in, fixtures, users](#definition-scopes-built-in-fixtures-users)
- [Add a workflow](#add-a-workflow)
- [Integrate a provider without writing code](#integrate-a-provider-without-writing-code)
- [Add a connector adapter](#add-a-connector-adapter)
- [Add a field type or text format](#add-a-field-type-or-text-format)
- [Add an email template](#add-an-email-template)
- [Add an SSO provider](#add-an-sso-provider)
- [Add a package](#add-a-package)

## Definition scopes: built-in, fixtures, users

Both `workflows/` and `email-templates/` are split into three scopes:

```
workflows/                       email-templates/
├── built-in/   shipped with the application, not configurable
├── fixtures/   examples backing local development and CI; skipped when NODE_ENV=production
└── users/      yours — relocatable with WORKFLOWS_USERS_DIR / EMAIL_TEMPLATES_USERS_DIR
```

`built-in/` and `fixtures/` resolve relative to the repository root and cannot be moved. Only
`users/` can, which is what lets a deployment mount its own definitions without forking the
repository. Under Docker Compose the first two ship inside the engine image and the host `users/`
directories are mounted read-only:

```bash
WORKFLOWS_USERS_DIR=/absolute/path/to/my-workflows docker compose up
```

Only `.json` files directly inside a workflow scope are discovered — there is no recursion into
subdirectories, and no other file format is loaded.

## Add a workflow

Drop a `.json` file into `workflows/users/` and restart the engine. It validates the file, stores it
and serves it. The quickest start is to copy the closest example from
[workflows/fixtures/](../workflows/fixtures/): `base`, `conditional-fields-and-transitions`,
`file-upload`, `manual-review`, `http-request`, `twilio-verify`, `sendgrid-email` and `manual-smtp`.

A workflow declares an `id`, a `version`, an optional `initial` step and a list of steps. There is
no type at the workflow root — a workflow is classified by the connectors it calls, and some call
none. Each step names the data it collects, the connectors it calls in order, and a transition per
outcome. A connector declaration names the adapter by `id` and repeats what that adapter does as
`type`, one of `kyc`, `kyb`, `aml`, `credit`, `phone_verification`, `email_verification`,
`email_delivery`, `sms_delivery`, `bank_verification`, `payment`, `e_signature`,
`document_storage` and `custom`; declaring a `type` that
disagrees with the adapter fails at startup. The
statuses a step may carry are `awaiting_user`, `awaiting_manual_review`, `approved`, `rejected` and
`invalid`; transitions are keyed by `success`, `rejected`, `manual.approve`, `manual.reject` and
`manual.invalid`.

**Files are only the definition source.** At startup the engine writes every discovered workflow
into the `workflows` table keyed by `(workflow_id, version)`, leaves an unchanged revision alone,
updates a changed one in place, and afterwards serves everything from that table — so a workflow can
also live only in the database. Startup fails when a file is malformed or schema-invalid, or when
two files declare the same `id` **and** `version`.

**Publish a change as a new revision:** add a file with the same `id` and a higher `version` rather
than editing a stored one. Starting an onboarding without naming a version picks the highest stored
version and pins the onboarding to it for its whole lifetime, so nothing in flight changes shape
under a customer.

Field types, the `persist` flag, `connectorData` vs `acceptedData` and the available validation
formats are covered in
[step-data-validation.md](../packages/engine/docs/step-data-validation.md).

## Integrate a provider without writing code

If the provider speaks plain JSON over HTTP, use the built-in `http_request` connector and describe
the call entirely in the workflow's `config`. Placeholders come from exactly three namespaces:

| Placeholder                                            | Resolves to                                                                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `{{payload.<key>}}`                                    | a `fieldMapping` key on this connector                                                                         |
| `{{secrets.<alias>.<key>}}`                            | an operator-stored `<alias>.<key>` setting — the database is the only source, there is no environment fallback |
| `{{execution.onboardingId}}`, `{{execution.stepName}}` | the current execution                                                                                          |

Outcomes map by status: `2xx` accepts, `4xx` becomes retryable field errors translated back to your
workflow's field names, and `3xx`/`5xx`/network/timeout is an integration failure rather than the
customer's fault. `response.errorStatuses` exists so a `401` from a rotated credential is not blamed
on the person filling in the form.

There is deliberately **no `context` namespace**: every value sent to a third party must be declared
on the step, which is what keeps the outbound data flow auditable by reading the workflow JSON alone.
A `{{secrets.*}}` reference's syntax is checked when the workflow loads, but whether it actually
resolves to a value is checked at execution time instead, since an operator can store a secret over
the admin API at runtime. A workflow referencing a secret nobody has configured yet still loads; the
gap surfaces as `503 CONNECTOR_NOT_CONFIGURED` on the onboarding that reaches it.

Full contract: [http-request-connector.md](../packages/engine/docs/http-request-connector.md).

## Add a connector adapter

When a provider needs real code — an SDK, a signature scheme, a non-JSON payload — implement the one
`ConnectorAdapter` interface in
[connector-adapter.port.ts](../packages/engine/src/connectors/ports/connector-adapter.port.ts).
An adapter declares an `id` — its own unique identifier, `twilio_verify` — and a `type`, what it
does, from `CONNECTOR_TYPES`: `kyc`, `kyb`, `aml`, `credit`, `phone_verification`, `email_verification`,
`email_delivery`, `sms_delivery`, `bank_verification`, `payment`, `e_signature`,
`document_storage` and `custom`.
Two providers of the same capability share a value, so `sendgrid_email` and `smtp` are both
`email_delivery`, and `custom` covers a connector with no capability of its own. The capability
groups connectors for an operator; it never changes how one is invoked. `execute` receives the declaration,
the execution identifiers, the onboarding context and the mapped payload, and returns one of
`accepted`, `rejected`, `invalidData`, `pending` or `invalid`.

An adapter that needs credentials declares a `settingsSchema` — the keys it accepts, which are
secret, which are required, and an optional `pattern` a submitted value must match — and reads
them through `ConnectorSettingsService.resolve(this)`
rather than `ConfigService` directly. That is what puts the adapter on `/v1/admin/connectors`,
letting an operator supply and rotate its credentials at runtime. The database is the only
source: there is no environment fallback, so a key absent from `connectors` is
unconfigured and raises `503 CONNECTOR_NOT_CONFIGURED` at execution time. An adapter with no
`settingsSchema` is not configurable and does not appear on the admin API.

1. **Put the class under `packages/engine/src/connectors/adapters/users/`.** The built-in and
   fixture adapters live in sibling directories; keeping yours separate makes a fork easy to rebase.
2. **Register it** in `USER_CONNECTOR_ADAPTER_PROVIDERS` in
   [connectors.module.ts](../packages/engine/src/connectors/connectors.module.ts) — the slot exists
   for exactly this. Startup asserts that every connector `id` is unique across all adapters.
3. **Implement `validateDeclaration`** if your adapter requires particular `config`, so a bad
   workflow fails at boot instead of on someone's onboarding.
4. **For a provider that answers later**, set `supportsAsyncCallback` and declare `callbackAuth` —
   startup refuses one without the other. Return `pending` from `execute`; the provider then calls
   `POST /v1/webhooks/<your id>/callback` and the engine resumes the connector chain from that
   connector's order, skipping everything already done. See
   [connector-callback-signatures.md](../packages/engine/docs/connector-callback-signatures.md) and
   the reference implementation in
   [mock-async-callback.connector.ts](../packages/engine/src/connectors/adapters/fixtures/mock-async-callback.connector.ts).

Workflows then reach your adapter by its `id`, which a step's connector declaration names directly
(`{"name": "...", "id": "twilio_verify", "type": "phone_verification"}`). `fieldMapping` is the only
channel from onboarding data into it. What that mapping may name is settled at load time: a source field must be
written in the same step, or in a step every path passes through. Nothing else in the engine changes.

Adapters shipped today: `http_request`, `twilio_verify`, `sendgrid_email`, `smtp`, and the `mock_*`
fixtures used by the example workflows.

## Add a field type or text format

Field types and validation formats are two registries in `@tsh/ddl-schema` rather than a checked-in
schema — see [fields/](../packages/shared/ddl-schema/src/fields/) and
[formats/](../packages/shared/ddl-schema/src/formats/). A new one is an entry plus its guard, with no
engine change, and because the package is framework-free the admin panel and any future authoring
tool pick it up from the same contract.

What a new type or format must respect is described in
[extending-field-types.md](../packages/shared/ddl-schema/docs/extending-field-types.md).

## Add an email template

Put an HTML file in `email-templates/users/` and reference it from a connector by its scope-prefixed
path — `"templatePath": "users/welcome.html"`. Template variables are supplied through the step's
`fieldMapping`. A path that omits a known scope prefix, is absolute, or resolves outside its scope
directory is rejected and the connector step fails. `email-templates/fixtures/manual-smtp.html`,
together with the `manual-smtp` workflow, is a working example against the local MailHog sink.

## Add an SSO provider

Microsoft Entra ID is the only implemented provider, but signing operators in against a different
directory is confined to three places:

1. An entry in the panel's `SSO_PROVIDERS` registry
   ([auth-config.ts](../packages/admin-panel/src/features/auth/config/auth-config.ts)), with the
   client wiring behind it.
2. A member of the engine's [`SsoProvider`](../packages/engine/src/auth/sso-provider.ts) enum, with
   an `AdminTokenVerifierPort` implementation registered in `auth.module.ts`.
3. That provider's required settings in `validateConfig`.

The request guard, the audit trail and the admin endpoints only ever see the port, so they do not
change. Both sides must name the same provider — `VITE_SSO_PROVIDER` on the panel and
`ADMIN_SSO_PROVIDER` on the engine — or the panel hands the engine tokens it refuses. An
unsupported value is refused by name at startup rather than falling back to Entra.

## Add a package

`pnpm-workspace.yaml` picks up `packages/*` and `packages/shared/*`. The root scripts fan out with
`pnpm -r --if-present run <script>`, so a new package joins `lint`, `typecheck`, `build` and the test
suites the moment it defines those script names — there is no central list to update.

Keep new shared contracts framework-free, as `@tsh/ddl-schema` is: it is what allows the workflow
format to be consumed without dragging NestJS along.
