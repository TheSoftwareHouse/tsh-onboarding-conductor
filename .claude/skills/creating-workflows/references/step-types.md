# The step-type vocabulary

Twenty built-in types, what each one exposes as ports, what it collects, and what it publishes to
the document contract. `docs/IMPLEMENTATION.md` §2.1 is the specification; this file is the lookup
table for authoring, and every value in it is derived from
`packages/shared/ddl-schema/src/step-types/`.

Dump the exact config schema for a type rather than guessing at a key:

```bash
node -e "const d=require('./packages/shared/ddl-schema/dist/index.js');for(const t of d.listStepTypes())if(t.type===process.argv[1])console.log(JSON.stringify(t.buildConfigSchema(),null,2))" <type>
```

(If that errors with `MODULE_NOT_FOUND`, run `pnpm --filter @tsh/ddl-schema build` first.)

## The table

`config*` marks a required config key. "Fields" are the field names the type contributes to its own
entry step — those names are what a `when`, a `fieldMapping` and a submit body use.

| Type                        | Ports                                                                                                            | Required config                                                                            | Fields it contributes                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `form`                      | `success`                                                                                                        | `fields`                                                                                   | whatever `fields` declares; `canonical` maps a field to a canonical role                                                            |
| `contact-details`           | `success`                                                                                                        | —                                                                                          | `email`, `phoneNumber` (each `required` \| `optional` \| `omitted`, default `required`)                                             |
| `consents`                  | `success`                                                                                                        | `consents`                                                                                 | per entry: `<key>Version` when `version` is set, plus `<key>Accepted` / `<key>Acknowledged` / `<key>Consent` from `acknowledgement` |
| `identity-profile`          | `success`                                                                                                        | `nationalities`                                                                            | `firstName`, `middleNames`, `lastName`, `dateOfBirth`, `nationality`                                                                |
| `address`                   | `success`                                                                                                        | `countries`                                                                                | `street`, `town`, `postCode`, `country`, plus `street2` / `region` when enabled; `prefix` prefixes them all                         |
| `questionnaire`             | `success`                                                                                                        | `sections`                                                                                 | the preset items of each section (below)                                                                                            |
| `document-choice`           | one per `documents[].type`                                                                                       | `documents`                                                                                | `documentType` (rename with `field`) and `<docType>IssuingCountry` per entry                                                        |
| `document-capture`          | `success`                                                                                                        | `document`                                                                                 | `<docType>Document`, or `<docType>Front` + `<docType>Back` when `sides: 2`                                                          |
| `selfie-capture`            | `success`                                                                                                        | —                                                                                          | `selfieDocument` (rename with `field`)                                                                                              |
| `otp-verify`                | `verified`, `refused`                                                                                            | `connector`                                                                                | `verificationCode` on the `verify` sub-step, never persisted                                                                        |
| `kyc-identity-verification` | `verified`, `review`, `retry.IDENTITY`, `retry.SELFIE`, `retry.APPLICANT_DATA`, `retry.QUESTIONNAIRE`, `refused` | `connector`, `levelName`, `sourceKey`, `questionnaireDefinitionId`, `maxAttemptsPerDocSet` | `kycOutcome`, `kycRetryStep`, `kycReasonCodes`, `kycCustomerMessage`                                                                |
| `decision`                  | one per `branches[].port`, plus `default` when `fallback: true`                                                  | `branches`                                                                                 | none — costs an empty POST                                                                                                          |
| `risk-score`                | one per `bands[].port`, plus `default` when `fallback: true`                                                     | `rules`, `bands`                                                                           | none — costs an empty POST                                                                                                          |
| `manual-review`             | `approve`, `reject`, `invalid` (optional)                                                                        | —                                                                                          | none                                                                                                                                |
| `http-call`                 | `success`                                                                                                        | `request`                                                                                  | none                                                                                                                                |
| `notify`                    | `success`                                                                                                        | `connector`, `recipientField`                                                              | none                                                                                                                                |
| `connector-call`            | `success`, plus `rejected` when a connector declares `canReject`                                                 | `connectors`                                                                               | whatever `fields` declares                                                                                                          |
| `wait-for-external`         | `received`                                                                                                       | `fields`                                                                                   | whatever `fields` declares                                                                                                          |
| `custom`                    | none — its `transitions` name compiled step names                                                                | `transitions`                                                                              | whatever `data` declares                                                                                                            |
| `terminal`                  | none                                                                                                             | `outcome` (`approved` \| `rejected` \| `invalid`)                                          | none                                                                                                                                |

Composable types — the only ones that may appear in another step's `include` — are `form`,
`contact-details`, `consents`, `identity-profile`, `address` and `questionnaire`.

**Reach for the type that owns the data, not for `form`.** A specialized type publishes _canonical_
fields — the contract a later step consumes by role — while a `form` publishes only what its
`canonical` block maps, so a `form` that happens to collect an `email` is invisible to anything
asking for the canonical one. Email or phone is `contact-details` (each independently `required`,
`optional` or `omitted`, so a step that wants the address alone sets `"phoneNumber": "omitted"`);
terms, privacy notices and marketing opt-ins are `consents`; name and date of birth
`identity-profile`; a postal address `address`; KYC questions `questionnaire`. Each is either the
step's own `type` or a fragment in another step's `include`, which is how one screen collects
contact details and the consents that go with them. `form` is the type for what none of them covers.

## Optional config, per type

The table above lists what a type **requires**. These are everything else it accepts; anything not
listed for a type is `UNKNOWN_PROPERTY`.

| Type                        | Optional config                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------ |
| `form`                      | `canonical`                                                                                            |
| `contact-details`           | `email`, `phoneNumber` (each `required` \| `optional` \| `omitted`, default `required`)                |
| `consents`                  | —                                                                                                      |
| `identity-profile`          | `middleNames` (default `optional`), `maxNameLength`, `minAgeYears`, `maxAgeYears`                      |
| `address`                   | `street2`, `region`, `maxStreetLength`, `maxTownLength`, `maxPostCodeLength`, `prefix`                 |
| `questionnaire`             | —                                                                                                      |
| `document-choice`           | `field` (default `documentType`)                                                                       |
| `document-capture`          | `sides` (`1` \| `2`, default `1`), `contentTypes`, `maxSizeBytes`                                      |
| `selfie-capture`            | `field` (default `selfieDocument`), `contentTypes`, `maxSizeBytes`                                     |
| `otp-verify`                | `channel` (`sms` \| `email` \| `voice`), `recipientField`, `codeField`, `codePattern`, `resendReasons` |
| `kyc-identity-verification` | —                                                                                                      |
| `decision`                  | `fallback`                                                                                             |
| `risk-score`                | `fallback`                                                                                             |
| `manual-review`             | —                                                                                                      |
| `http-call`                 | `connector`, `response`, `fieldMapping`                                                                |
| `notify`                    | —                                                                                                      |
| `connector-call`            | `fields`, `canonical`                                                                                  |
| `wait-for-external`         | —                                                                                                      |
| `custom`                    | `status`, `data`, `connectors`, `scoring`                                                              |
| `terminal`                  | —                                                                                                      |

## Presets

`nationalities` and `countries` take a literal ISO alpha-2 array or one of two preset names:
`eea` (30 states) and `eea-id-card-issuers` (28 — Denmark and Ireland issue no national ID card).

`questionnaire.sections` takes any of `purpose`, `employment`, `funds`, `declarations`:

| Section        | Fields, with the provider path each maps to                                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `purpose`      | `accountPurpose` → `purpose.account_purpose`                                                                                                                        |
| `employment`   | `employmentStatus` → `employment.employment_status`, `occupationGroup` → `employment.occupation_group` (ISCO-08), `occupationTitle` → `employment.occupation_title` |
| `funds`        | `sourceOfFunds` → `funds.source_of_funds`, `monthlyIncomingBand` → `funds.monthly_in_band`, `monthlyOutgoingBand` → `funds.monthly_out_band`                        |
| `declarations` | `pepSelfDeclared` → `declarations.pep_self_declared`                                                                                                                |

A `consents` entry is `{ key, version?, acknowledgement?, required? }` — `key` is required and names
the fields (`<key>Version`, `<key>Accepted`), `version` pins the document revision and is what
produces the `<key>Version` field at all, `acknowledgement` is `accepted` (default) | `acknowledged`
| `consent`, and `required: false` makes the acknowledgement optional.

Uploads default to `image/png`, `image/jpeg`, `application/pdf` (a selfie: no PDF) and 10 MiB;
override per step with `contentTypes` and `maxSizeBytes`.

**Document type strings are not validated anywhere.** `document-choice`'s `documents[].type` and
`document-capture`'s `document` are free strings that travel verbatim to the provider as Sumsub's
`idDocType`. `PASSPORT`, `ID_CARD`, `DRIVERS_LICENSE` and `SELFIE` are that vocabulary, not an enum
the DDL enforces — a typo compiles, and the only thing that catches it is the separate rule that
every offered option needs a matching capture step. They also drive field naming, so `ID_CARD`
becomes `idCardFront` / `idCardIssuingCountry`.

## Composition

**`include`** merges a composable type's fields into this step's entry step. Own fields first, then
each fragment in declared order — that is the order the client renders. A name collision between
the step and a fragment is `DUPLICATE_FIELD_NAME` at `steps[i].include[j]`.

**`edges`** maps a port to a step name, or to an ordered arm list. Every non-optional port must be
wired; an unwired one, or a key naming a port the type does not expose, is `INVALID_TRANSITIONS` at
`steps[i].edges.<port>`. An edge names an **authored** step; the compiler resolves it to that
step's entry compiled step, so `"capture_id_card"` reaches `capture_id_card_front` on its own.

```jsonc
"edges": {
  "success": [
    { "when": { "field": "country", "equals": "FR" }, "target": "domestic_check" },
    { "target": "international_check", "webhook": { "notify": false } } // unconditional, so last
  ]
}
```

At most one arm may lack a `when`, and it must come last — but a list may equally be **all**
conditional, and then no fallback is missing. With no arm matching, a submit ends the onboarding
`invalid` and a `manual-review` trigger is refused with `MANUAL_TRANSITION_NOT_AVAILABLE`; a
document that wants either outcome writes the conditional arms alone, as
`conditional-fields-and-transitions-typed` does. `webhook: { notify: false }` on an arm is the only
place an outbound-notification opt-out can be written.

**`substeps`** renames a generated sub-step. `otp-verify` named `send_phone_code` compiles to
`send_phone_code`, `send_phone_code_verify` and `send_phone_code_resend`; `"substeps": {"verify":
"verify_phone_code", "resend": "resend_phone_code"}` restores names a client already knows. A key
the type does not produce is `INVALID_VALUE` at `steps[i].substeps.<key>`. Two-sided
`document-capture` uses keys `front` and `back`.

**`scoring`** on any step attaches `[{ score, when?, add }]` to the compiled step whose submit
decides the outcome — the entry step, or the check for `otp-verify`. `terminal` and `risk-score`
refuse the list. Routing on the result needs no `risk-score` step: a conditional edge's `when` takes
a score leaf.

**`risk-score`** has no fixture anywhere in the repository, so there is nothing to copy. Its grammar:

```jsonc
{
  "name": "score_risk",
  "type": "risk-score",
  "config": {
    "rules": [{ "score": "risk", "when": { "field": "country", "in": ["RU"] }, "add": 40 }],
    "bands": [{ "port": "refer", "score": "risk", "gte": 40 }], // exactly one comparator per band
    "fallback": true, // adds the `default` port
  },
  "edges": { "refer": "manual_review", "default": "provision" },
}
```

A band takes exactly one of `gte` / `gt` / `lte` / `lt`; two is `INVALID_VALUE`. Bands are tried in
declared order, first match wins. `port` may not be the literal `default`, which is reserved for the
`fallback` port, and a repeated port is `DUPLICATE_TRANSITION`. A rule's `add` is a **non-zero**
integer and its `score` must name a score declared in the document's **root** `scoring` object.

**`meta`** is a free-form object on the root and on any step; carried, never read.

## What the contract carries between steps

Every step's publications are assembled before any step compiles, scoped to that step's
**ancestors** — the steps with an edge path to it. A capture step placed after the check never
reaches the check's upload table.

| Published by                          | What                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------ |
| `identity-profile`                    | canonical `firstName`, `middleNames`, `lastName`, `dateOfBirth`, `nationality` |
| `address`                             | canonical `street`, `street2`, `town`, `region`, `postCode`, `country`         |
| `contact-details`                     | canonical `email`, `phoneNumber`                                               |
| `form` / `connector-call`             | whatever `canonical` maps                                                      |
| `document-capture` / `selfie-capture` | one captured document per upload, with its doc set type and side               |
| `document-choice`                     | one document option per entry, with its issuing-country field                  |
| `questionnaire`                       | one item per field, with its provider path                                     |

Two steps claiming one canonical role is `DUPLICATE_FIELD_NAME`.

`kyc-identity-verification` consumes all of it. It requires canonical `firstName`, `lastName`,
`dateOfBirth`, `nationality`, `country`, `street`, `town`, `postCode`, at least one questionnaire
item and at least one captured document — every one of them from an ancestor. Any gap is
`INVALID_VALUE` at load, which is the check working. A document option offered by a
`document-choice` that no capture step collects is also `INVALID_VALUE`.

## Connector bindings

A type that calls a connector declares a slot; a binding outside it is `INVALID_VALUE` at
`steps[i].config.connector`.

| Type                        | Accepts                                                              | Default                 |
| --------------------------- | -------------------------------------------------------------------- | ----------------------- |
| `otp-verify`                | `phone_verification`, `email_verification`                           | inferred from `channel` |
| `kyc-identity-verification` | `kyc`                                                                | —                       |
| `notify`                    | `email_delivery`, `sms_delivery`                                     | —                       |
| `http-call`                 | `custom`                                                             | `http_request`          |
| `connector-call`            | no slot — full declarations, exactly as a compiled step carries them | —                       |

A binding carries `name` (a label for the connector inside the compiled step, independent of `id`),
`id` (the adapter) and `type` (the capability). Only **`type`** is checked, and only against the
slot; the `id` is never checked against the adapter registry until the engine boots.

`type` is optional, and **every checked-in document omits it**, taking the slot's default — correct
whenever the id you named is of that default capability. The cost is that an id of a _different_
capability compiles clean and fails at boot with `WORKFLOW_CONNECTOR_DECLARATION_INVALID`. Declaring
`type` moves that failure to compile time, which is worth doing when the slot accepts more than one
capability (`otp-verify`, `notify`) and you are not copying a working example.

`http-call` is the exception and has its own idiom: its slot admits one adapter and defaults to it,
so the whole `connector` object is optional and the repo writes only a label —
`"connector": { "name": "account_provisioning" }`.

Every binding also takes the failure policy: `errorHandler`, `retry` (`maxAttempts` 1–5, `delayMs`
0–5000) and up to three `fallback` entries of the same capability with different `id`s. What the
author may add beside the derived keys differs: `otp-verify` accepts extra `fieldMapping` keys (and
`startConfig` / `checkConfig`, per entry); `kyc-identity-verification` and `notify` accept extra
`fieldMapping` and `config`; `http-call` accepts none. An addition that would override a derived key
is refused.

Every registered adapter id, by `type`:

| `type`               | Built-in                 | Fixture mocks                                         |
| -------------------- | ------------------------ | ----------------------------------------------------- |
| `kyc`                | `sumsub_kyc`             | `mock_kyc_1`, `mock_kyc_2`, `mock_sumsub_file_upload` |
| `phone_verification` | `twilio_verify`          | `mock_phone_verification`                             |
| `email_verification` | **none**                 | `mock_email_verification`                             |
| `email_delivery`     | `sendgrid_email`, `smtp` | `mock_email_delivery`                                 |
| `custom`             | `http_request`           | `mock_async_callback`                                 |

**There is no production `email_verification` adapter in this repository.** An email one-time code
runs on `mock_email_verification` until one is written, which confines such a flow to `fixtures/`.

`email_delivery` is the only capability with two non-mock adapters, so it is the only one whose
`fallback` chain can be built outside `fixtures/`.

Error handler ids: `fallback_on_error` (the default), `retry_then_fallback`, `continue_on_error`.
To re-read the registry, match constructor-registered ids too — four adapters register through a
base class, and a `readonly id =` grep silently misses every one of them:

```bash
grep -rnE "readonly (id|type) = |super\('" packages/engine/src/connectors/adapters packages/engine/src/connectors/error-handlers
```

`packages/engine/src/connectors/adapters/README.md` carries the same list in prose.

What the `notify` adapters demand of the binding differs, and is not derivable from the slot:

| Adapter          | Needs in `fieldMapping` (payload)                                                                                      | Needs in `config` |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------- |
| `sendgrid_email` | `templateId` — payload only, so pin a constant with a `persist: false` field whose `validation.oneOf` is the single id | —                 |
| `smtp`           | `subject`                                                                                                              | `templatePath`    |

## `http-call`'s request template

`config.request` is `{ method, url, headers?, query?, body?, timeoutMs? }` and `config.response` is
`{ errorsPath?, errorStatuses? }` (`errorStatuses` takes 4xx codes only). `config.fieldMapping`
renames the source field behind a `{{payload.<key>}}`; every placeholder the request references
becomes a mapping key on its own, so a placeholder with no source fails at load. Placeholders come from exactly three namespaces —
`{{payload.<key>}}` (a `fieldMapping` key on this step), `{{secrets.<alias>.<key>}}` (an entry of
`HTTP_CONNECTOR_SECRETS`, checked at load) and `{{execution.onboardingId}}` /
`{{execution.stepName}}`. There is deliberately no `context` namespace: everything sent to a third
party is declared on the step.

**Omit `config.fieldMapping` in the normal case.** Every `{{payload.<key>}}` the request references
becomes a mapping key on its own, resolved to the contract field of the same name — the built-in
flow declares no `fieldMapping` and compiles to `{"firstName": "firstName", "lastName": "lastName",
…}`. Declare it only to point a payload key at a _differently named_ source field; a placeholder
that resolves to no field at all fails at load. Full contract:
`packages/engine/docs/http-request-connector.md`.

## Reaching for the escape hatches

`connector-call` when the connector has no specialized type — a fixture mock, a provider integrated
by declaration alone. It collects `fields` (and takes `include` and `canonical` like `form`) and
declares `connectors` in full.

`custom` when nothing else fits. It carries one compiled step verbatim — `status`, `data`,
`connectors`, `scoring`, `transitions` naming **compiled step names**, not ports. Its config is
validated against the compiled schema's own definitions, so a mistake is reported at
`steps[i].config.…`. Everything `docs/EXTENDING.md` → "Add a workflow" says about the compiled form
applies verbatim inside it.

A fixture's `custom` twin is therefore a transcription, not a second authoring pass. Compile the
typed form, then wrap each compiled step: keep `name` where it is, add `"type": "custom"`, and move
everything else that step carries (`status`, `data`, `transitions`, and `connectors` / `scoring`
when it has them) under `config`. Nothing else changes but the root `id` and `name`, and the result
is what `checked-in-workflows.spec.ts` compares in `IDENTICAL_PAIRS`. Hand-writing the twin instead
is how one drifts from its pair — and an invented connector id in the `custom` form compiles clean
and fails at boot.
