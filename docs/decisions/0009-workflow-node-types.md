# 0009. Specialized node types are an authoring layer that compiles to steps

- **Status:** Superseded
- **Date:** 2026-09-07
- **Tags:** workflows, ddl-schema, authoring
- **Supersedes:** —
- **Superseded by:** 0010

## Decision

A workflow may be authored in either of two forms. The existing form declares `steps`. The new
form declares `nodes`: a graph of typed nodes, each naming a node type, a config, the fragments
merged into its own step, and a target node per named output port.

Three choices shape it:

**A node graph compiles to the step form before anything validates it.** `nodes` at the document
root routes through `compileNodeGraph`, whose output is an ordinary `RawWorkflowDefinition` that
then goes through the same schema, the same normalizer and the same structural rules as a
hand-written document. The runtime keeps the single homogeneous step shape, so the engine learns
nothing about nodes — `validateAndNormalizeWorkflow` is the only seam, and it is already the one
place both file loading and database read-back go through.

**Node types are a registry, mirroring the field-type registry.** `BUILT_IN_NODE_TYPES` plus
`registerNodeType`; the node-graph JSON Schema is derived in memory from the registry and keyed to
its version, exactly as the step schema is derived from the field-type registry. A node type
declares its config schema, its ports, the sub-steps it compiles to, the fields it contributes, and
what it publishes to the document contract.

**Compilation is two-phase, over a document-wide contract.** Each node may publish canonical field
roles, captured documents, offered document options and questionnaire items; every publication is
assembled before any node compiles, and handed to all of them. This is what lets a
`kyc-identity-verification` node derive its entire connector declaration — a sixteen-entry field
mapping, a five-entry optional mapping and a four-document upload table — from what its neighbours
collect rather than from config restating it.

Eighteen types ship: `form`, `consents`, `identity-profile`, `address`, `questionnaire`,
`document-choice`, `document-capture`, `selfie-capture`, `otp-verify`,
`kyc-identity-verification`, `decision`, `risk-score`, `manual-review`, `http-call`, `notify`,
`wait-for-external`, `custom-step`, `terminal`.

## Context

`docs/IMPLEMENTATION.md` §1 committed to "a single homogeneous step shape. There are no step
types", and `docs/EXTENDING.md` opened by saying the engine "deliberately has no connector
categories and no step types, so there is less to hook into than you might expect". That
commitment was right about the runtime and is kept: it is what makes async waiting, manual review
and terminal states the same mechanism, and it is why the engine's advance loop has one branch
instead of eighteen.

It was, however, being paid for entirely by authors. `eu-b2c-individual-kyc-eea` — one flow, in one
jurisdiction — is 906 lines. The measured weight is not distributed: `submit_kyc` alone is 209
lines, the three steps of one OTP challenge are 153, and the EEA country list appears verbatim four
times for 128 more. Nearly half the document is one connector declaration and one phone
verification.

Worse, the repetition is the load-bearing kind. `submit_kyc`'s field mapping has to agree with
every capture step, its `documents` table with the document choice's issuing-country fields, its
`questionnairePathMap` with the questionnaire step's enums, and its seven `when`-qualified
transition arms with the retry targets the adapter can name. Nothing checks those agreements as a
group; each is checked only as "this source field exists somewhere". A reviewer cannot verify one
by reading one place.

The driver was a drag-and-drop builder, which needs two things the step form cannot give it: a
palette of things to place, and named outcomes to draw arrows between. `submit_kyc`'s seven
transition arms are seven ports; a canvas can draw those, but it cannot draw
`{"all":[{"field":"kycOutcome","equals":"retry"},{"field":"kycRetryStep","equals":"IDENTITY"}]}`.

**Why compile rather than interpret.** A second runtime shape would double the engine's advance
loop, its `/state` descriptor and every structural rule in the DDL, and give the two forms room to
mean different things. Compiling instead means one runtime contract and one set of rules, and it
makes equivalence testable: revision 2 of the built-in workflow is the same flow authored as a node
graph, and `eu-b2c-node-graph-equivalence.spec.ts` pins it to revision 1 step by step — identical
fields, connectors and transitions, except that revision 2 sends the one-time code from a step of
its own. 906 lines against 271, proven to say the same thing.

**Why a node binds a connector by capability.** A step declares a connector by id, and whether that
id can do what the step needs is only discovered when the adapter runs. A node type knows what it
needs — an OTP challenge needs a `phone_verification` or `email_verification` connector, an identity
check needs `kyc` — so it declares a slot of connector types and the compiler refuses a binding
outside it at load, with a path. Where the type derives the connector's payload from the contract,
the author may add keys beside it but never override one: the derivation is what the type is for.

**Why `custom-step` exists.** It passes a hand-written step through verbatim, which guarantees the
node form is never less expressive than the form it compiles to and lets a document migrate one
node at a time. The cost is that its transitions name step names rather than being edges, so a
builder must render it as opaque.

**Why ports rather than conditions on edges.** Conditional edges would have been a smaller
mechanism, but they put the author back in the business of writing the condition that distinguishes
two outcomes. A port is named by the node type that produces it, so `retry.IDENTITY` is spelled
once, in the type, rather than in every document that routes on it.

## Consequences

- **A stored node-graph document cannot be read by an engine without the node layer.** The
  `workflows` table holds the authored document and re-validates it on read-back, so rolling the
  DDL package back past this change makes an already-stored node-graph revision fail at boot with
  `INVALID_SHAPE`. Observed, not theorised. A rollback has to remove the row.
- Two of the control-flow node types cost the customer a round trip. `decision` and `risk-score`
  collect nothing, and the engine only advances an onboarding on a submit, so each is a step the
  client must POST to. Prefer a specialized node's own ports — `document-choice` routes on the same
  submit that collects the choice — or, since the same day, a **conditional edge** on any port,
  which forks without a step of its own.
- A document still holds at most one `kyc-identity-verification` node. The adapter emits fixed
  callback keys (`kycOutcome` and its three companions) and field names are unique across a
  document, so the node cannot namespace them to lift the limit.
- Two node types this repository has no runtime for were deliberately **not** built: a `timer` (no
  scheduler runs against a parked onboarding — BullMQ carries outbound webhooks only) and
  `parallel`/`join` (the advance loop holds a single `currentStep`). Both need engine work and a
  decision of their own.
- `WorkflowInvalidError` gained an optional `path` into the document, for both authored forms, so a
  builder can point at the node — or the field — at fault. The message stays the stable code.
- Node types are an authoring concern, so they belong to `@tsh/ddl-schema` rather than the engine.
  That keeps them consumable by a builder UI or a BFF, which is the same reason the DDL package has
  no Nest dependency.
