# 0041. Admins read the stored document of every workflow version

- **Status:** Accepted
- **Date:** 2026-10-12
- **Tags:** workflows, admin-panel, api
- **Supersedes:** [0033](0033-admin-workflow-details.md), its refusal to serve the source document (the "View JSON" option it rejected); [0034](0034-admin-authored-workflow-drafts.md), its `409 WORKFLOW_VERSION_NOT_DRAFT` on `/document` for a non-draft version and "Published documents stay withheld"
- **Superseded by:** —

## Decision

`GET /v1/admin/workflows/{workflowId}/versions/{version}/document` serves the stored document of
any version, `draft`, `published` or `retired`, verbatim, including connector `config` and
`{{secrets.*}}` placeholders as written. It stays admin-only and answers `404 WORKFLOW_NOT_FOUND`
for a revision outside the active scopes. `PUT` and `DELETE` on a non-draft version keep
`409 WORKFLOW_VERSION_NOT_DRAFT`. Reads are not audited, like every other admin read.

- The `operationId` becomes `getWorkflowVersionDocument`, and
  `AdminWorkflowDraftDocumentResponseDto` becomes `AdminWorkflowVersionDocumentResponseDto`, whose
  `status` is any of the three.
- Every version on `/workflows/:workflowId` shows **Graph | JSON** tabs, driven by `?view=`. A draft
  opens on JSON and a published or retired version on Graph.
- A published or retired version's JSON tab is the stored document, read-only, with a Copy JSON
  action.
- A draft's Graph tab is the dry-run compile (`POST /v1/admin/workflows/compile`) of the editor's
  current text, run when the tab opens, on Validate and on Publish. The compiled graph is never
  stored and never fetched from a new route.

## Context

0033 refused to serve the source document because connector `config` can hold literal values, such as
`http-call` header values. 0034 relaxed that for drafts only, since an admin typed them. Operators
now want to read a published flow's JSON, and a draft's graph has to follow the text being edited,
which only a compile of that text can give. The user accepted that admins see literal `config`
values: the route is already admin-only, and every admin can already edit the drafts that hold them.

## Alternatives

| Option                                               | Why not                                                                                                                                |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Serve the document with `config` redacted            | Literal values and adapter settings are not placeholders, so a redaction rule must be right for every connector type; 0033 rejected it |
| A separate published-only document route             | Two routes for one resource; `/document` already exists and only its status guard changes                                              |
| Compile the draft graph while typing                 | A compile per keystroke for text that is mostly invalid; Validate, Publish and opening the tab already compile                         |
| Project the draft graph client-side, without compile | A second interpreter of the typed-steps document that would drift from the engine's compile                                            |

## Consequences

Any admin can read connector `config` of any version, published, retired or built-in included. The
HTTP contract changes one operation's name and DTO, and the document route loses its `409`. A draft
that does not compile shows an error in place of its graph until the JSON is fixed. Graph editing
will later build on the compile's `source` mapping. Reversing this means restoring the draft-only
guard on the route; stored rows are unchanged.
