# Extending the engine

Most extension happens in JSON rather than TypeScript. Reach for code only when the declarative
route genuinely cannot express what you need — the engine's runtime has no connector categories and
one kind of step, so there is less to hook into than you might expect.

**Step types are the exception, and they are an authoring layer rather than a runtime one.** A
workflow is written as typed steps — that is the only form a document takes — and they compile to
the one step shape the engine runs before anything validates them, so the engine still only ever
sees that shape. See [Author a workflow with step types](#author-a-workflow-with-step-types) and
[Add a step type](#add-a-step-type).

This document assumes you have the local stack running; see the [README](../README.md).

## Contents

- [Definition scopes: built-in, fixtures, users](#definition-scopes-built-in-fixtures-users)
- [Add a workflow](#add-a-workflow)
- [Collect acceptance of an agreement](#collect-acceptance-of-an-agreement)
- [Author a workflow with step types](#author-a-workflow-with-step-types)
- [Add a step type](#add-a-step-type)
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
and serves it. A file is a list of typed steps — see the next section for the vocabulary — and the
quickest start is to copy the closest example from [workflows/fixtures/](../workflows/fixtures/),
each of which ships twice: `<name>.workflow.json` written as `custom` steps, one hand-written
compiled step each, and `<name>-typed.workflow.json` written through the specialized types. The examples are
`base`, `conditional-fields-and-transitions`, `file-upload`, `manual-review`, `http-request`,
`twilio-verify`, `sendgrid-email`, `manual-smtp`, `connector-fallback`, `sumsub-kyc` and `scoring` —
`sumsub-kyc` is the one to copy for a provider that answers on a callback rather than in the same
request, `scoring` for named scores and score-conditioned transitions. The production reference
flow is [`eu-b2c-individual-kyc-eea`](../workflows/built-in/), shipped built-in in both forms —
revision 1 as `custom` steps, revision 2 (`-v2`) through the specialized types: EU B2C individual
KYC across all 30 EEA states, where the applicant chooses between a passport and a national ID card.

**A document written as untyped steps no longer loads.** A step without a `type` — the compiled
shape, which every workflow was once written in — is refused with `INVALID_SHAPE` at that step. Run
`pnpm workflow:compile old.workflow.json --from-untyped` and save what it prints: the same steps,
each wrapped in a `custom` step, which compiles back to exactly the document you had. Everything
below about steps — statuses, transitions, refusal reasons, scoring, fallback chains — is stated
over the compiled steps a document compiles to, so it applies verbatim to what a `custom` or a
`connector-call` step declares and to what every other step type produces.

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
`capture_id_card_front`. Revision 2 says the same through `document-choice`, which exposes one port
per document (`PASSPORT`, `ID_CARD`) in place of the `when` arms, and `kyc-identity-verification`
derives the `documents[]` table and its optional mappings from the `document-capture` step on each
branch.

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
genuine refusal is never routed back into the flow by accident. Written as `custom` steps, the
built-in `eu-b2c-individual-kyc-eea` carries those arms by hand on `verify_phone_code`. Through the
specialized `otp-verify` type they are generated: the type emits the re-send step itself and routes
`CHALLENGE_EXPIRED` and `CHALLENGE_NOT_FOUND` to it, so revision 2 and
`workflows/fixtures/twilio-verify-typed.workflow.json` wire only `verified` and `refused`.

A workflow may also declare named numeric scores — `scoring: { <name>: { min, max } }` at the root,
integer bounds, `min < max` — and adjust them from a step's own `scoring: [{ score, when?, add }]`
rules. Every matching rule's `add` is summed and clamped to `[min, max]` once per step, so
declaration order never changes the result, and an onboarding starts each score at its `min`. A
transition's `when` may then route on the result with `{ score, gte | gt | lte | lt }`, nested
inside `all` / `any` / `not` like any other condition — but a field's `when` and a scoring rule's
own `when` may not name a score, since the score leaf only resolves server-side and `/state`
publishes a field's `when` to the client as-is. `workflows/fixtures/scoring.workflow.json` is the
worked example as `custom` steps; `scoring-typed.workflow.json` says the same with step-level
`scoring` on `identity-profile`, `otp-verify` and `kyc-identity-verification`, and score leaves on
conditional edges.

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

## Collect acceptance of an agreement

Terms, a privacy notice or anything else a customer has to accept is an **agreement**, not a
document — `documents` in this engine means uploaded files. An agreement family is identified by a
`key`, its versions are numbered by the engine, and a workflow never names a version.

Two things have to line up.

**1. Publish version 1 of the family** before any onboarding on the workflow starts:

```bash
curl -X POST http://localhost:3000/v1/admin/agreements \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -d '{"key":"my-terms","type":"terms_and_conditions"}'
```

The route is guarded, so `$ADMIN_TOKEN` is an operator's Entra access token; locally with
`ADMIN_AUTH_ENABLED=false` the header can be dropped. The engine assigns `version: 1`, or
`MAX(version) + 1` if the family already exists. `type` belongs
to the family, so a later publish under the same `key` with a different `type` is rejected. There is
no `name` and no content: the entity records identity and version only.

**2. Declare the family at the root of the workflow**, naming the step that collects the tick and a
boolean field of that step:

```jsonc
{
  "id": "my-workflow",
  "version": 1,
  "name": "My Workflow",
  // A root member, beside `steps` — the same place the `scoring` declarations sit.
  "agreements": [{ "key": "my-terms", "step": "accept_terms", "acceptedWhen": "acceptedTerms" }],
  "steps": [
    {
      "name": "accept_terms",
      "type": "custom",
      "config": {
        "status": "awaiting_user",
        "data": {
          "acceptedTerms": {
            "type": "boolean",
            "required": true,
            "validation": { "oneOf": [true] },
          },
        },
        "transitions": [{ "status": "success", "target": "approved" }],
      },
    },
  ],
}
```

`step` must name a step of the workflow — any step type will do, not just `custom` — and
`acceptedWhen` a field declared in **that** step whose type is `boolean` and which is not
`persist: false`; the submit path reads the marker back out of the stored context, so any of those
being wrong is a startup failure. Keys match `^[a-z0-9][a-z0-9-]*$` and each family is declared
once; one step may collect several families.

Starting an onboarding then writes a `pending` link per declared family at the family's latest
version, and submitting the step with the field `true` records the acceptance. Forgetting step 1 is
the common mistake: a declared family with nothing published fails every start on that workflow with
`503 AGREEMENT_NOT_PUBLISHED`.

Publishing a later version links it as `pending` to every onboarding that accepted an older one and
sends each an `onboarding.agreement_pending` webhook, so
`GET /v1/onboardings?agreementStatus=outdated` is the list of who owes the new one. Working
examples: `base-terms` on `accept_terms` in [`workflows/fixtures/base.workflow.json`](../workflows/fixtures/base.workflow.json),
and `eu-b2c-terms` plus `eu-b2c-privacy-notice` on `collect_contact` in
[`eu-b2c-individual-kyc-eea`](../workflows/built-in/). The root is the only place the array is
accepted, whatever the steps are written as: `base.workflow.json` and `base-typed.workflow.json`
declare the same family identically, and both revisions of `eu-b2c-individual-kyc-eea` do too —
revision 1 as `custom` steps, revision 2 as specialized ones whose `consents` member generates the
field `acceptedWhen` names.

**Adding a new agreement type** is one array entry. `AGREEMENT_TYPES` in
[agreement.types.ts](../packages/engine/src/agreements/agreement.types.ts) holds
`terms_and_conditions` and `privacy_notice`; the publish DTO, the admin list filter and the webhook
payload all validate against that array, and the OpenAPI document's `AgreementType` enum is spread
from it, so the only other step is `pnpm openapi:generate`. `type` is a classification for
operators and consumers — the engine's behaviour is identical for every value.

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

## Author a workflow with step types

A document declares `steps`, each naming a step type, and the engine compiles them into the one
step shape it runs before validating it, so everything the previous section says still applies —
the same statuses, the same field types, the same startup checks. What the specialized types change
is how much you write: `workflows/built-in/eu-b2c-individual-kyc-eea-v2.workflow.json` is the same
flow as revision 1 in 271 lines rather than the 957 revision 1 needs as `custom` steps, and a spec
pins the two to each other step by step — identical, except that revision 2 sends the one-time code
from a step of its own.

A step names a type, its config, the fragments merged into it, and a target step per output port:

```jsonc
{
  "name": "collect_personal",
  "type": "identity-profile",
  "config": { "nationalities": "eea", "minAgeYears": 18, "maxAgeYears": 120 },
  "include": [
    { "type": "address", "config": { "countries": "eea" } },
    {
      "type": "form",
      "config": { "fields": { "actingForSelf": { "type": "boolean", "required": true } } },
    },
  ],
  "edges": { "success": "collect_purpose" }, // port → step
}
```

Most steps compile to exactly one runtime step of the same name; a few types — `otp-verify`, a
two-sided `document-capture` — compile to several, named `<step>_<key>`. Five rules are worth
knowing before you start:

**An edge names a step, not a compiled step.** The compiler resolves it to that step's entry step,
so you never have to know that `capture_id_card` starts at `capture_id_card_front`. Every
non-optional port must be wired; an unwired one fails the document at load rather than compiling a
step that goes nowhere.

**`include` merges fields into one screen.** Only a composable type may appear there — `form`,
`contact-details`, `consents`, `identity-profile`, `address`, `questionnaire`. The step type's own
fields come first, then each fragment in declared order, and that is the order the client renders.
Use `{"type": "form", "config": {"fields": {…}}}` for a field no fragment covers.

**Specialized steps find each other through canonical names.** `identity-profile` publishes
`firstName`, `lastName`, `dateOfBirth` and `nationality`; `address` publishes `street`, `town`,
`postCode` and `country`; `questionnaire` publishes each answer with the provider path it maps to;
the capture steps publish which document they collect. `kyc-identity-verification` builds its whole
connector declaration from those, which is why its config is five keys rather than 209 lines. The
corollary is that it fails at load if nothing in the document collects an attribute it needs —
that is the check working, not a bug.

**A step that calls a connector says which kind it can drive.** `otp-verify` takes a
`phone_verification` or `email_verification` connector and assumes the one its `channel` implies;
`kyc-identity-verification` takes `kyc`; `notify` takes `email_delivery` or `sms_delivery`;
`http-call` takes `custom` and defaults to `http_request`. Binding anything else fails at load with
the path of the offending `connector`, and `GET /v1/admin/step-types` lists each type's
`connectorTypes` so a builder can offer only connectors that fit. Where the type derives the
connector's payload, you may add to it but not override it: `otp-verify` accepts extra
`fieldMapping` keys beside `recipient` and `code`, and `kyc-identity-verification` accepts extra
`fieldMapping` and `config` keys beside what it builds from the contract.

Collecting a contact address and proving it are two steps. `contact-details` collects `email` and
`phoneNumber` — each `required`, `optional` or `omitted` — under the names `otp-verify` looks for,
so the verification step needs no field configuration of its own:

```jsonc
{
  "name": "collect_contact",
  "type": "contact-details",
  "config": { "email": "required", "phoneNumber": "required" },
  "include": [{ "type": "consents", "config": { "consents": [{ "key": "terms" }] } }],
  "edges": { "success": "send_phone_code" },
},
{
  "name": "send_phone_code",
  "type": "otp-verify",
  "substeps": { "verify": "verify_phone_code", "resend": "resend_phone_code" },
  "config": { "channel": "sms", "connector": { "id": "twilio_verify" } },
  "edges": { "verified": "collect_personal", "refused": "rejected" },
}
```

`otp-verify` sends to whatever the channel's canonical field resolves to — `phoneNumber` for `sms`
and `voice`, `email` for `email` — and fails at load if no earlier step publishes it; set
`recipientField` when the number lives under another name. Its second compiled step collects the
code and never persists it.

**Rename a generated step when a client depends on the old name.** Compiled step names are
client-visible. `otp-verify` named `send_phone_code` generates `send_phone_code_verify`;
`"substeps": {"verify": "verify_phone_code"}` keeps the name a caller already knows. That is how
revision 2 of the built-in workflow keeps revision 1's step names.

**Any step may score.** `"scoring": [{ "score", "when"?, "add" }]` on a step attaches the rules to
the compiled step whose submit decides the step's outcome — the entry step, or the check for
`otp-verify` — and a conditional edge may then route on the result with a score leaf, so a risk
band needs no `risk-score` step of its own. `terminal` and `risk-score` refuse the list.

**Any arm may opt out of the client notification.** `{ "target": "…", "webhook": { "notify": false } }`
on an edge arm is the compiled form's per-transition opt-out, reachable from every port.

**A connector binding carries its failure policy.** Beside `id`, `name`, `type` and the additions
the slot allows, a `connector` block may name `errorHandler`, `retry` and up to three `fallback`
entries — each an `id` of the same capability, with its own `retry` and, where the slot allows,
`fieldMapping` and `config` additions laid under the keys the type derives (an entry declaring none
inherits the primary's). `otp-verify` entries may carry their own `startConfig` and `checkConfig`.
`workflows/fixtures/connector-fallback-typed.workflow.json` is the worked example;
`connector-fallback.workflow.json` is the same chain declared in full on a `custom` step's connector.

Reach for `connector-call` when the connector you need has no specialized type — a mock adapter in
a fixture, a provider integrated by declaration alone. It collects `fields` (and takes `include`
and `canonical` like `form`) and declares `connectors` exactly as a compiled step does, in full; it
exposes `success`, and `rejected` whenever one of them declares `canReject`. `manual-review`'s
`invalid` port is optional for the same reason: a hand-written review need not offer it.

Reach for `custom` when nothing else can say what you need. It carries a hand-written compiled step
verbatim — status, data, connectors, scoring and raw transitions — so typed steps are never less
expressive than the compiled form they compile to, and a document written as untyped steps converts
to a list of these one step at a time. Its transitions name compiled step names rather than ports,
so it is opaque to a builder, and its config is validated against the compiled schema's own
definitions, so a mistake is reported at `steps[i].config.…`.

`decision` and `risk-score` collect nothing, and the engine advances an onboarding only on a
submit, so each costs the customer an extra empty `POST /submit`. Prefer a specialized step's own
ports where you can — `document-choice` routes on the same submit that collects the choice — or a
**conditional edge**, which forks any port without a step of its own:

```jsonc
"edges": {
  "success": [
    { "when": { "field": "country", "equals": "FR" }, "target": "domestic_check" },
    { "target": "international_check" }, // the fallback, which must come last
  ],
}
```

**`meta`.** A free-form object on the root and on any step, ignored by the compiler and kept in the
stored document — where a builder keeps titles, descriptions and canvas positions.

**When something is wrong, the error says where.** `WorkflowInvalidError.path` names the step, the
edge or the config member at fault — `steps[3].edges.PASSPORT`, `steps[0].config.connectors[0]` —
and `pnpm workflow:compile <file>` prints it. `POST /v1/admin/workflows/compile` runs the same
checks, plus every adapter's own and source-key uniqueness against the store, and returns the
compiled steps and each step's ports without storing anything; `GET /v1/admin/step-types` and
`GET /v1/admin/step-types/schema` serve the palette and the schema a builder needs.

The full type list, their ports and the presets they carry are in
[IMPLEMENTATION.md §2.1](./IMPLEMENTATION.md#21-step-types-the-authored-form).

## Add a step type

One module implementing `WorkflowStepTypeDefinition` plus one entry in
`packages/shared/ddl-schema/src/step-types/step-type.registry.ts`. There is no schema file to edit —
the workflow JSON Schema is derived from the registry in memory and keyed to its version, exactly as
the compiled schema is derived from the field-type registry.

```ts
type WaitingRoomConfig = { readonly note: string };

export const waitingRoomStepTypeDefinition = {
  type: 'waiting-room',
  category: 'collect',
  buildConfigSchema: () => ({
    type: 'object',
    additionalProperties: false,
    required: ['note'],
    properties: { note: { type: 'string', minLength: 1 } },
  }),
  parseConfig: (config, fail) =>
    typeof config?.note === 'string' ? { note: config.note } : fail('INVALID_VALUE'),
  listPorts: () => [{ name: 'success' }],
  listSubStepKeys: () => [null],
  buildFields: () => ({ waitingRoomNote: { type: 'text', required: true } }),
  compile: (context) => [
    {
      name: context.stepNames[0],
      status: 'awaiting_user',
      data: context.fields,
      transitions: [{ status: 'success', target: context.targets.success }],
    },
  ],
} as const satisfies WorkflowStepTypeDefinition<WaitingRoomConfig>;
```

What each member owes the compiler:

- **`buildConfigSchema`** is composed into the workflow schema behind an `if type is X` arm, and is
  what a builder renders a config form from. Use `additionalProperties: false` so a typo fails at
  load naming the property.
- **`parseConfig`** is the authority; the schema is the diagnostic. Validate anything the schema
  cannot express here, and resolve every default so `compile` reads a complete config.
- **`listSubStepKeys`** returns `null` for the step's own name and a key for each generated
  sub-step; `[0]` is the entry step every inbound edge resolves to. Return as many keys as
  `compile` returns steps — a mismatch fails the document.
- **`buildFields`** contributes to the step's _entry_ step only. A later sub-step's fields are
  created in `compile`.
- **`resolveScoringStepKey`** is optional and names the sub-step a step's own `scoring` attaches
  to; left out, the entry step. Return `undefined` from a type with nothing to score on, and a step
  of it declaring `scoring` fails at `steps[i].scoring`.
- **A type that calls a connector** declares a `connectorSlot`, reads the binding with
  `readConnectorBinding`, lays the author's additions under what it derives with
  `mergeDerivedWithExtras`, and spreads `buildFailurePolicy(binding, deriveEntry)` onto the
  declaration it emits, so `errorHandler`, `retry` and the fallback chain reach every provider in
  the slot. `notify.step-type.ts` is the shortest worked example.
- **`context.targets[port]`** is opaque. Write it as a transition's `target` and nothing more; the
  compiler substitutes the destination — or fans the transition out into one arm per condition,
  for a conditional edge — after you return. Writing a target for a port you were not given, or
  ignoring one that was wired, fails the document as a type defect.
- **`publish`** is optional, and is how a downstream step finds what you collect. Claim a canonical
  role only when your field genuinely means that attribute — two steps claiming one role fails the
  document.
- **`compile`** receives the merged fields, the resolved target step per port, and the assembled
  document contract. Emit ordinary compiled steps; nothing downstream knows a step type produced
  them.

Mark a type `composable` only if it compiles to exactly one step with no connectors and no ports
beyond `success` — `step-type.registry.spec.ts` asserts that for every composable type, because a
fragment's control flow would be silently discarded when it is merged.

Mount a type from outside the package with `registerStepType(definition)` during startup, before
the first workflow is validated. `step-type.registry.spec.ts` proves that path end to end,
including that the schema rebuilds around the new type.

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
   for exactly this. Startup asserts that every connector `id` is unique across all adapters. That
   registration is also what makes `GET /v1/admin/connectors` report the adapter's `scope` as
   `users` — the same `built-in` / `fixtures` / `users` vocabulary as workflow and email-template
   scopes, derived from which provider array the adapter sits in, not from anything you declare on
   the class.
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
   ([auth-config.ts](../packages/admin-panel/src/services/auth/auth-config.ts)), with the
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
