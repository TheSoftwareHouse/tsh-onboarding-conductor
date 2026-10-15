# 0047. The `credit-assessment` step takes bank data as an uploaded document and bands the score from its config

- **Status:** Proposed
- **Date:** 2026-10-15
- **Tags:** step-types, workflows, documents, credit, bnpl, authoring
- **Supersedes:** —
- **Superseded by:** —

## Decision

`credit-assessment` is a built-in step type of category `verify` with the slot
`{ types: ['credit'], extras: 'none' }`. It owns one input field, `bankData`, of type `file`
(`contentTypes: ['application/json']`, `maxSizeBytes` default 1 MiB, required), uploaded through
the existing reserve → PUT → complete document flow and then submitted like any field. Its
config is `connector { id }`, `bands { approveFrom: 700, reviewFrom: 400 }` validated
`approveFrom > reviewFrom`, `maxAttempts` (default 3), optional `applicant` role bindings,
`products` (default `['creditScore', 'paymentScore']`), `report: 'full' | 'summary' | 'none'`
(default `full`) and `bankDataMaxSizeBytes`. Ports are `approved`, `review`, `declined`,
`retry`. It compiles to one `awaiting_user` step with one `{ async: true, order: 1 }` connector,
a `fieldMapping` carrying `bankData` and any applicant roles, and `when: { field:
'creditOutcome', equals: … }` arms with `review` last and unconditional. The bands are authored
in the workflow document, so a workflow moves the thresholds without a code change, and the
kernel of [0045](./0045-credit-assessment-kernel-algoan-first-provider.md) applies them.

The provider-shaped results the step declares as callback-only fields — `creditIndicators`,
`creditSecondaryScores` and `creditReport` — have no fixed shape, so the DDL gains one built-in
field type, `json`: a root-level field whose value is any JSON object, accepting no `validation`
block, carrying the usual root keys (`required`, `clientVisible`). The existing `object` type keeps
requiring a closed `fields` map; `json` is the only open shape. It is a root-level field type any
step may declare; the credit step uses it for callback-only provider data, which the engine's
`CALLBACK_ONLY` guard keeps a client from submitting. Nothing stops an author declaring an
applicant-writable `json` field, and its only bound is then the engine's request body limit.

## Context

The demo pushes a persona's Open Banking data (10–20 KB of JSON today, larger for real
aggregator exports) and must force a predefined result; the thresholds that turn a 0–1000 score
into approve / review / decline are a lender's policy and change per workflow. The engine's JSON
body limit is around 100 KB and the DDL's field conditions compare equality only, so neither an
inline `object` field nor edge conditions on the numeric score fits.

## Alternatives

| Option                                                                | Why not                                                                                                                                                                     |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bank data as an inline `object` field in the submit body              | Hits the engine's body limit for real exports, stores the whole export in `onboardings.context` and in audit rows, and duplicates what the document flow already does       |
| Numeric comparators on DDL field conditions, bands expressed as edges | A DDL extension affecting every step type for one consumer; listed as future work, and the step's config keeps the thresholds next to the connector that produces the score |
| Thresholds as connector settings                                      | Settings are per provider instance, not per workflow; two workflows on one Algoan project could not differ                                                                  |
| Bands hard-coded in the kernel                                        | The user asked for configurable thresholds in the DDL; defaults stay in the step schema                                                                                     |
| Declaring the report as a closed `object` field                       | `object` requires a `fields` map and rejects unknown keys, so a provider's open document would fail the parked step's validator and lose the verdict                        |
| A generic `verify` step with a custom `object` field for the file     | Loses the typed `file` validation (`contentTypes`, size) `document-capture` already resolves through `resolveUploadValidation`                                              |

## Consequences

Workflow authors declare the step with a connector and bands; the compiled graph and the
admin panel render it like any typed step. The bank-data document is retained under the
onboarding's documents with the usual lifecycle. A persona push larger than
`bankDataMaxSizeBytes` fails at reserve, before any provider call. `docs/EXTENDING.md` and the
documentation site's step-type reference gain the step.
