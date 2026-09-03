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
- [Add a connector error handler](#add-a-connector-error-handler)
- [Add a field type or text format](#add-a-field-type-or-text-format)
- [Add an email template](#add-an-email-template)
- [Add an SSO provider](#add-an-sso-provider)
- [Add a package](#add-a-package)

## Definition scopes: built-in, fixtures, users

Both `workflows/` and `email-templates/` are split into three scopes:

```
workflows/                       email-templates/
├── built-in/   shipped with the application, not configurable
├── fixtures/   examples backing local development and CI (workflows only: skipped when NODE_ENV=production)
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
`file-upload`, `manual-review`, `http-request`, `twilio-verify`, `sendgrid-email`, `manual-smtp`
and `sumsub-kyc` — the last is the example to copy for a provider that answers on a callback
rather than in the same request. The production reference flow is
[`eu-b2c-individual-kyc-eea`](../workflows/built-in/), the one shipped built-in workflow: EU B2C
individual KYC across all 30 EEA states, where the applicant chooses between a passport and a
national ID card.

A step that parks on an `async: true` connector must declare **every** field that connector's
callback can submit: the engine re-submits the callback body through the parked step, and an
undeclared key is an `UNKNOWN` field error that loses the verdict. For `sumsub_kyc` that is
`kycOutcome`, `kycRetryStep`, `kycReasonCodes` and `kycCustomerMessage`. Since field names are
unique across a whole document, only one step per document can declare them — a workflow may
therefore contain at most one `sumsub_kyc`-parked step.

Because of that, anything that varies per applicant must vary inside one connector declaration. A
`sumsub_kyc` document mapping may set `countryField` instead of `country`, naming a payload key that
carries the applicant's own ISO alpha-2 issuing country, so one declaration serves every
jurisdiction — that is how `eu-b2c-individual-kyc-eea` covers all 30 EEA states in a single file. A `countryField`, like a `payloadField`, must name a key one of the declaration's mappings carries
— required or optional — checked at startup by the adapter's `validateDeclaration` hook. `idDocType` has no
equivalent and stays fixed, so one `documents[]` entry still serves one document type.

To offer a **choice** of document in one workflow, declare one `documents[]` entry per type, mark
each `optional: true`, and name their payload keys in `optionalFieldMapping` rather than
`fieldMapping`:

```json
"fieldMapping": { "selfieDocumentId": "selfieDocument" },
"optionalFieldMapping": {
  "passportDocumentId": "passportDocument",
  "idCardFrontId": "idCardFront",
  "idCardBackId": "idCardBack"
}
```

An absent optional source is omitted from the payload instead of failing the step, and an optional
`documents[]` entry whose payload key never arrived is skipped. Optional mappings are also exempt
from the rule that a source must live in a step which always runs before the connector's — a source
written on one branch and absent on the other is exactly what they declare. That exemption is what
lets the capture steps sit on separate branches of a conditional transition, so an applicant walks
only the ones their own document needs. The source must still persist: an unpersisted cross-step
source is absent on every path, an authoring error rather than optionality.

`eu-b2c-individual-kyc-eea` is the worked example — `select_document_type` collects `documentType`,
its two `success` arms each carry a `when`, and they route to `capture_passport` or to
`capture_id_card_front`.

A workflow declares an `id`, a `version`, a `name`, an optional `initial` step and a list of steps. There is
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

Within one status group a conditional arm may be followed by **at most one** unconditional arm, which
must come last, and a status may not be declared twice unconditionally. The unconditional arm is
optional: when the conditions are exhaustive — a closed enum, say — name them all and omit it, rather
than letting an "everything else" arm silently absorb a value added to the enum later. The cost is
that a submit matching no arm ends the onboarding `invalid`.

A `rejected` transition may add `reason` — any of `ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`,
`CHALLENGE_NOT_FOUND`, `CONNECTOR_REJECTED` — to claim only those refusals, and such an arm may
target any step. Use it to recover from a refusal that is not really about the customer, such as a
one-time code that expired before it was typed:

```json
{ "status": "rejected", "reason": ["CHALLENGE_EXPIRED"], "target": "resend_phone_code" },
{ "status": "rejected", "target": "rejected" }
```

An arm without `reason` is still required and must still end on a terminal `rejected` step, so a
genuine refusal is never routed back into the flow by accident. The built-in
`eu-b2c-individual-kyc-eea` is the worked example.

A connector declaration may also name `errorHandler` — the `id` of a registered
`ConnectorErrorHandler`, defaulting to `fallback_on_error` when omitted — and `fallback`, an
ordered array of up to three further declarations of the same `type` but different `id`s, tried in
turn as each provider before them runs out of attempts. A fallback's `fieldMapping` and
`optionalFieldMapping` each inherit the primary's when it declares none, and a declared one
replaces the inherited map rather than merging into it; its `config` never inherits and defaults to
`{}`. `order`,
`async`, `canReject` and `errorHandler` are not repeated on a fallback — one failure policy governs
the whole slot, the whole chain included.

`retry` is the one policy a chain entry decides for itself: `{"maxAttempts": 1..5, "delayMs":
0..5000}`, defaulting to `{"maxAttempts": 2, "delayMs": 0}` on the primary and, on an entry,
overriding the primary's resolved policy field-wise — an entry naming only `maxAttempts` keeps the
slot's interval. The executor waits `delayMs` between two attempts at the same connector and
refuses to spend more than 20 seconds waiting per slot, whatever the document declares. See
[Add a connector error handler](#add-a-connector-error-handler) below for the four actions a
handler may return.

**Files are only the definition source.** At startup the engine writes every discovered workflow
into the `workflows` table keyed by `(workflow_id, version)`, leaves an unchanged revision alone,
updates a changed one in place, and afterwards serves everything from that table — so a workflow can
also live only in the database. Startup fails when a file is malformed or schema-invalid, or when
two files declare the same `id` **and** `version`.

**Publish a change as a new revision:** add a file with the same `id` and a higher `version` rather
than editing a stored one. Starting an onboarding without naming a version picks the highest
**published** revision — a revision moved to `draft` or `retired` is skipped even when its number is
higher — and pins the onboarding to it for its whole lifetime, so nothing in flight changes shape
under a customer.

Field types, the `persist` flag, `connectorData` vs `acceptedData` and the available validation
formats are covered in
[step-data-validation.md](../packages/engine/docs/step-data-validation.md).

## Integrate a provider without writing code

If the provider speaks plain JSON over HTTP, use the built-in `http_request` connector and describe
the call entirely in the workflow's `config`. Placeholders come from exactly three namespaces:

| Placeholder                                            | Resolves to                                      |
| ------------------------------------------------------ | ------------------------------------------------ |
| `{{payload.<key>}}`                                    | a `fieldMapping` key on this connector           |
| `{{secrets.<alias>.<key>}}`                            | an entry of the `HTTP_CONNECTOR_SECRETS` env map |
| `{{execution.onboardingId}}`, `{{execution.stepName}}` | the current execution                            |

Outcomes map by status: `2xx` accepts, `4xx` becomes retryable field errors translated back to your
workflow's field names, and `3xx`/`5xx`/network/timeout is an integration failure rather than the
customer's fault. `response.errorStatuses` exists so a `401` from a rotated credential is not blamed
on the person filling in the form.

There is deliberately **no `context` namespace**: every value sent to a third party must be declared
on the step, which is what keeps the outbound data flow auditable by reading the workflow JSON alone.
Every `{{secrets.*}}` reference is checked against `HTTP_CONNECTOR_SECRETS` when the workflow loads,
so a missing secret fails startup rather than someone's onboarding.

Unlike a dedicated adapter, this connector declares no `settingsSchema`: its aliases and keys are
named by workflow JSON rather than by the adapter, so its secrets stay deployment configuration and
it never appears on `/v1/admin/connectors`.

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
   startup refuses one without the other. Return `accepted` from `execute` and declare `async: true`
   on the workflow step; the engine — not the adapter — parks the step, and the provider then calls
   `POST /v1/webhooks/<your id>/callback` and the engine resumes the connector chain from that
   connector's order, skipping everything already done. See
   [connector-callback-signatures.md](../packages/engine/docs/connector-callback-signatures.md) and
   the reference implementation in
   [mock-async-callback.connector.ts](../packages/engine/src/connectors/adapters/fixtures/mock-async-callback.connector.ts).

   [sumsub-kyc.connector.ts](../packages/engine/src/connectors/adapters/built-in/sumsub-kyc.connector.ts)
   is the richest example shipped: async with a real `callbackAuth` recipe, a `settingsSchema`
   carrying a secret field, a per-declaration `config` it parses itself
   (`sumsub-kyc/sumsub-config.ts`), documents resolved through `CompletedOnboardingDocumentResolver`
   and `ObjectStoragePort` the same way `mock_sumsub_file_upload` does, and a `mapCallbackResult`
   that maps a provider verdict to a domain outcome carried in `submittedData` rather than to an
   engine transition — see [decision 0005](decisions/0005-kyc-connector-outcome-contract.md) for
   why.

Workflows then reach your adapter by its `id`, which a step's connector declaration names directly
(`{"name": "...", "id": "twilio_verify", "type": "phone_verification"}`). `fieldMapping` and
`optionalFieldMapping` are the two channels from onboarding data into it. What they may name is
settled at load time: a source field must be written in the same step, or in a step every path
passes through — except for an optional mapping, which is exempt from that second half precisely
because it declares a source that may be absent. Nothing else in the engine changes.

Adapters shipped today: `http_request`, `twilio_verify`, `sendgrid_email`, `smtp`, `sumsub_kyc`,
and the `mock_*` fixtures used by the example workflows.

## Add a connector error handler

A connector error handler is a policy for what happens when a connector's adapter throws: retry,
fall back to a declared alternative, swallow the failure, or propagate it. It never performs that
decision itself — `handle` is synchronous and pure, and only `WorkflowConnectorExecutorService`
retries, falls back, continues or propagates.

Implement the one `ConnectorErrorHandler` interface in
[connector-error-handler.port.ts](../packages/engine/src/connectors/ports/connector-error-handler.port.ts):

```ts
export interface ConnectorErrorHandler {
  readonly id: string;
  handle(failure: ConnectorFailure): ConnectorFailureAction;
}
```

`id` is the value a connector declaration's `errorHandler` field names. `handle` receives the
declaration that failed, the thrown error, the `status` when the error was a Nest `HttpException`,
the current `attempt`, the declaration's resolved `retry` policy, and whether a further link of the
chain is available, and returns one of four actions:

| Action      | Meaning                                                                                   |
| ----------- | ----------------------------------------------------------------------------------------- |
| `retry`     | Call the same connector again, after its `retry.delayMs`. Bounded by `retry.maxAttempts`. |
| `fallback`  | Run the next link of the declaration's `fallback` chain in its place.                     |
| `continue`  | Swallow the failure: this connector counts as accepted, the chain moves on.               |
| `propagate` | Rethrow. The step does not advance and the caller sees the provider's error.              |

A handler sees only a thrown error, never a returned `rejected`, `invalidData` or `invalid` —
those are the adapter's own answer and stay authoritative; re-asking another provider after one
already said no would let an applicant shop for a yes.

1. **Put the class under `packages/engine/src/connectors/error-handlers/users/`.** The built-in
   handlers live in a sibling directory, mirroring how adapters are split.
2. **Register it** in `USER_CONNECTOR_ERROR_HANDLER_PROVIDERS` in
   [connectors.module.ts](../packages/engine/src/connectors/connectors.module.ts) — the slot
   exists for exactly this. Startup asserts that every handler `id` is unique across all groups.
3. **Name it** in a connector declaration's `errorHandler` field. A declaration that names none
   gets `fallback_on_error`, the default.

Three handlers ship today: `fallback_on_error` (the default — falls back when one is available,
else propagates), `retry_then_fallback` (a 4xx status goes straight to fallback-or-propagate; a
5xx or statusless failure retries while the declaration's own `retry.maxAttempts` allows, then
falls back or propagates), and `continue_on_error` (always continues). Full reference:
[error-handlers/README.md](../packages/engine/src/connectors/error-handlers/README.md).

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

## Scoring a workflow

A document can accumulate a score as an onboarding progresses and use it to decide who is checked
more closely. Three optional keywords; declaring none leaves a workflow behaving exactly as it did
before scoring existed.

Give a step a **weight**, and each of its transition arms **points**. The contribution is
`weight × points`, so one step can matter more than another without restating the numbers on every
arm:

```jsonc
{
  "name": "collect_profile",
  "status": "awaiting_user",
  "scoring": { "weight": 3 },
  "data": { "country": { "type": "text", "required": true } },
  "transitions": [
    // A known market: 3 x 10 = +30.
    {
      "status": "success",
      "when": { "field": "country", "in": ["PL", "DE"] },
      "target": "verify_identity",
      "points": 10,
    },
    // Anywhere else: 3 x 2 = +6.
    { "status": "success", "target": "verify_identity", "points": 2 },
  ],
}
```

Two arms of the same status may score differently — that is the reason `points` sits on the arm
rather than on the step.

Route on the running total with **`$score`**, compared using `gte` and `lt` only. A band is the
two composed under `all`:

```jsonc
{ "status": "success", "when": { "field": "$score", "gte": 80 }, "target": "approved", "points": 0 }
```

Bypass a step entirely with **`skip`**. When the condition holds at the moment the engine would
enter the step, the target is entered instead:

```jsonc
{
  "name": "enhanced_due_diligence",
  "status": "awaiting_user",
  "skip": { "when": { "field": "$score", "gte": 40 }, "target": "approved" },
  "data": { "sourceOfFunds": { "type": "text", "required": true } },
  "transitions": [{ "status": "success", "target": "approved", "points": 5 }],
}
```

Rules worth knowing before you write one:

- `$score` works in a transition or `skip` condition, never in a field's own `when` — the client
  re-resolves field visibility as the form fills and has no score. `equals`, `in` and `isSet`
  against `$score` are refused; it compares magnitude only.
- A skip chain must be acyclic, may not target its own step, and may not be declared on the
  initial step or on a terminal one. All of that is refused when the revision is loaded.
- **A step re-entered through a loop counts once, at its most recent outcome.** If your document
  routes a failure back to an earlier step — as the built-in EU KYC workflow does — the retried
  step contributes its latest result, not one contribution per attempt.
- The score is visible to operators only. It is never returned by the applicant-facing
  `GET /v1/onboardings/:id/state` or by the submit response.

`workflows/fixtures/scoring.workflow.json` is a complete worked example, including the retry loop.
