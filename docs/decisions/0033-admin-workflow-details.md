# 0033. The admin workflow read serves any revision, its steps' fields and connector identity

- **Status:** Accepted
- **Date:** 2026-09-29
- **Tags:** admin-panel, workflows, api
- **Supersedes:** —
- **Superseded by:** [0034](0034-admin-authored-workflow-drafts.md), its refusal to serve the source document for `draft` versions, and its `?version=N` pinned read, which moves to `/versions/{version}`

## Decision

A new `GET /v1/admin/workflows/{workflowId}/versions` lists every stored version of a family as
`{ items: [{ version, status, createdAt, updatedAt }] }`, highest version first and unpaginated. A
family outside the active scopes, or unknown, answers `404 WORKFLOW_NOT_FOUND`, as on every other
workflow read. A family holds a handful of versions and a version picker needs all of them, so there
is no page.

`GET /v1/admin/workflows/{workflowId}` serves a pinned `?version=N` whatever its status, `retired`
included, and no longer documents a `410`. Unpinned it still returns the highest published version.
The admin read has its own registry method: `getById`, `resolveForStart` and `getByVersionId` keep
refusing `retired` with `WORKFLOW_RETIRED` (410), so starting, submitting and reading an in-flight
onboarding are unchanged. Reading a revision is admin-only and changes nothing about whether it can
run.

The definition response, which `POST /v1/admin/workflows/compile` returns as `workflow`, grows
additively:

- root `webhook`: `{ notify: { path } }`, or `null` when the workflow declares none;
- per step, `source`: `{ step, type, category }` of the authored step it compiled from, or `null`
  when no report entry exists. It is computed at read time by `compileWorkflowReport` over the stored
  document, never stored on the normalized step, because step types are an authoring concern the
  runtime never learns about;
- per step, `fields[]`: `name`, `type`, `required`, `persist`, `when`, `schema` and `upload`, the
  same per-field projection the state route already serves applicants;
- per step, `connectors[]`: `id`, `name`, `type`, `order`, `canReject`, `async`, `fieldMapping` and
  `optionalFieldMapping`, each with the same for its `fallbacks`.

Connector `config`, `retry` and `errorHandler` stay off the wire. `config` holds provider settings,
`http-call` headers can be literal values, and `{{secrets.*}}` placeholders live only there. The
source document is not served either, for the same reason.

## Context

[0032](0032-admin-workflows-list.md) left `/workflows/:workflowId` a placeholder "until a versions
endpoint exists". The details page needs that endpoint, a definition it can read for any stored
version (an operator must inspect a retired or draft revision), and enough per step to fill the
inspector: fields, connectors and the step's authored type. The definition route omitted step
fields and connectors, and refused a retired revision with a 410 meant for run-time resolution.

## Alternatives

| Option                                              | Why not                                                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Serve connector `config`, redacting `{{secrets.*}}` | Literal header values and adapter settings are not placeholders; a redaction rule would have to be right for every connector type |
| Persist step `source` on the normalized step        | Puts an authoring concern into `domain/` and every stored document; the report already yields it on read                          |
| Keep refusing `retired` on the admin read           | The picker would list a version the page cannot open                                                                              |
| Relax `getById` to serve `retired` for every caller | Would let a retired revision start or continue an onboarding; run-time resolution must stay a hard stop                           |
| Paginate the versions route like other admin lists  | A family holds a handful of versions; a page would only hide some from the picker                                                 |
| Serve the source document for a "View JSON" action  | Carries the same config exposure as connector `config`                                                                            |

## Consequences

The definition response is larger, and the onboarding details page's parser sees the new fields, so
the panel reads them tolerantly. An operator can read a retired revision's fields and connector
mapping, but not its connector `config`; that surface stays the Connectors settings. `source` is
`null` for a step the report has no entry for, and every step of a built-in v1 is authored as
`custom`, so its type says little there. The versions route lists rows in every status, so a `draft`
that nothing in the engine writes still appears once an operator sets it by hand.
