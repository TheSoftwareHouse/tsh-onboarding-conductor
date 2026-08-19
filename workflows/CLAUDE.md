# Workflow JSON conventions — `workflows/`

Scoped rules for the declarative workflow documents the engine loads at boot from `WORKFLOWS_DIR`.
The root `CLAUDE.md` applies in full.

These files are **configuration, not fixtures with a free shape**. `@tsh/ddl-schema` validates every
one at startup, and an invalid document takes the process down rather than failing a request — so a
mistake here is a boot failure, not a bug report.

## Naming

- One workflow per file, named `<id>.workflow.json`, where the stem **is** the document's `id` in
  kebab-case. `email-otp.workflow.json` has `"id": "email-otp"`.
- Step names are `snake_case`. Terminal steps are named for the outcome they represent — `approved`,
  `rejected`, `invalid` — and the existing files use those three consistently.
- Connector `name` and `type` are `snake_case`; `config` and `fieldMapping` keys are camelCase.
- Shared assets (email bodies and the like) live in `templates/`, referenced by path from a connector's
  config.

## Shape

Top level is `id`, `version`, `name`, `initial`, `steps[]`. A step is `name`, `status`, and any of
`data`, `connectors[]`, `transitions[]` — **all three optional**. There are no step types: an async
wait, a manual review and a terminal state are the same shape with different content, so do not reach
for a new construct when an empty `connectors` or `transitions` expresses it.

`initial` must name a step that exists, every transition `target` must resolve, and duplicate step or
field names fail validation. Steps carry the domain status contract, not free strings.

## What belongs here

Each file in this directory demonstrates **one** connector or engine feature — that is what makes them
useful as a reference and as e2e material. Keep that: a new capability gets a new focused workflow
rather than another branch bolted onto `base.workflow.json`.

None of these are production workflows. `http-request.workflow.json` posts to the reserved placeholder
host `api.example.com`, and several have no failure branch. Do not treat them as templates for a real
deployment without adding the missing paths.

## Before adding a construct

A field type, text format or condition operator that does not exist yet is added in
`packages/shared/ddl-schema` — one module plus one registry entry — not worked around in JSON. Read
`packages/shared/ddl-schema/docs/extending-field-types.md` and
`packages/engine/docs/step-data-validation.md` first; the latter is canonical for field types,
`persist`, `connectorData` vs `acceptedData`, and validation formats.

Adding or changing a workflow that demonstrates a new construct means updating `docs/IMPLEMENTATION.md`
§2 in the same change.
