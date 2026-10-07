# 0034. Operators author workflow drafts in the database through the admin API

- **Status:** Accepted
- **Date:** 2026-10-06
- **Tags:** persistence, workflows, admin-panel, api, authoring
- **Supersedes:** [0029](0029-workflow-label-and-immutable-versions.md), its immutability rule for `draft` versions only; [0032](0032-admin-workflows-list.md), its statement that nothing in the engine writes `draft`; [0033](0033-admin-workflow-details.md), its refusal to serve the source document for `draft` versions, and its `?version=N` pinned read
- **Superseded by:** —

## Decision

The engine creates, edits and deletes `draft` workflow versions at runtime through the admin API,
storing them only in the database, in `users` scope, in the same families `workflows/users/` files
publish into. A draft is the authored typed-steps document, stored as authored, exactly like a
file-ingested version. Panel-created families are ordinary `users` families; nothing records where a
version came from.

- Drafts are written through the version resource, not a draft-specific path:
  - `POST /v1/admin/workflows` creates a draft from a document body, in the family its `id` names;
  - `PUT` and `DELETE /v1/admin/workflows/{workflowId}/versions/{version}` replace and remove one;
  - `GET .../versions/{version}/document` returns its stored document verbatim;
  - `PUT`, `DELETE` and `/document` on a version that is not a draft answer
    `409 WORKFLOW_VERSION_NOT_DRAFT`.
- The pinned compiled read moves to the same resource. `GET /v1/admin/workflows/{workflowId}/versions/{version}`
  serves the compiled definition of any stored version, retired and draft included, and
  `GET /v1/admin/workflows/{workflowId}?version=N` is removed. `GET /v1/admin/workflows/{workflowId}`
  keeps one meaning: the highest published version. One URL now reads, replaces and deletes a
  version.
- Saving needs only a JSON object with a string `id` and a positive integer `version`. A draft may
  fail compilation; the compile dry run tells the author, nothing refuses the save.
- A draft may change its `id` and `version` on update when the target is free. The new `id`/`version`
  must not exist in any status (`409 WORKFLOW_VERSION_EXISTS`), a family holds at most one draft
  (`409 WORKFLOW_DRAFT_EXISTS`), and the family cannot be in another scope
  (`409 WORKFLOW_SCOPE_CONFLICT`).
- A published version stays immutable. Only `draft` rows are updated or deleted, and only while
  no onboarding references them (`409 WORKFLOW_DRAFT_IN_USE`). Last write wins: there is no optimistic lock.
- Run-time resolution refuses a pinned draft with a new `409 WORKFLOW_VERSION_NOT_PUBLISHED`, so a
  draft never starts. No HTTP route pins a version at start today, so the guard sits in the
  registry's resolver and is on no route's contract yet; the unpinned start already resolves only
  `published`. An onboarding already on a hand-flipped draft keeps running.
- Drafts are tolerated as they are wherever stored versions are compiled in bulk: the boot sweep and
  the compile dry run skip `draft` rows, so an invalid draft is never compiled there and its
  connector `sourceKey`s stay out of the uniqueness check. The admin definition read of a draft
  that does not compile answers `400 WORKFLOW_INVALID` instead of a 500.
- At boot, a `users/` file whose `id`+`version` matches a draft is skipped with a logged error. A
  file colliding with a published version still fails the boot with `WorkflowVersionConflictError`.
- One draft per family is enforced by a partial unique index on `workflow_versions (workflow_id)`
  where `status = 'draft'`. Deleting a family's last version deletes the family.
- A draft names its family only when it creates the family. It never relabels an existing one.
- Create, update and delete are audited through `AuditService` with the identifiers and no body.

The admin panel adds a "New draft" modal (Empty or Upload) and a CodeMirror 6 JSON editor with
Validate, Save draft, Discard and Delete draft; a draft's details page is that editor. Publishing
(`draft → published`) is out of this record and follows separately; it will never retire other
versions.

## Context

Workflow files are read only at boot (`WorkflowRegistryService.onModuleInit` → `publishFromFiles`),
and `users/` is mounted read-only in Compose, so adding a flow means a file change and a restart. The
database is already the uncached read model, so a row written at runtime is served on the next
request by every instance. Operators want to author a flow in the running panel and iterate on it
before it goes live. A visual editor is planned and will emit the same typed-steps document, which is
why the raw document is what gets stored and edited. 0029's immutability exists to protect
onboardings pinned to a version. A draft that cannot start has no onboardings to protect, so making
drafts editable keeps that guarantee. 0033 withheld the source document because connector `config`
can hold literal values. A draft's document was typed by an admin through this same API, so serving
it back to an admin exposes nothing new. Published documents stay withheld.

## Alternatives

| Option                                                        | Why not                                                                                                                                                                    |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Write drafts as files under `workflows/users/` and hot-reload | The directory is read-only in Compose, multi-instance deployments would need a shared volume and a watcher on every instance                                               |
| Immutable drafts: every save is a new version                 | A draft is iterated on many times before publishing; versions would be burnt on typos                                                                                      |
| Require a valid document to save                              | An author could not save work in progress; the visual editor will produce intermediate invalid states                                                                      |
| An `origin` column marking panel-created families             | Rejected by the user: nothing behaves differently by origin, and a family keeps one scope (0030) either way                                                                |
| Let a pinned start run a draft, as today                      | An onboarding pinned to a draft would freeze the draft, and a draft would go live without a publish step                                                                   |
| Fail the boot when a `users/` file collides with a draft      | A draft saved at runtime could then stop the next deploy from starting                                                                                                     |
| Optimistic locking on update                                  | Out of scope for a single-operator authoring flow; can be added with a `version` precondition later                                                                        |
| Fork a published revision into a draft, templates             | Out of scope for now; Empty and Upload cover creation                                                                                                                      |
| `/drafts` and `/versions/{version}/draft` paths               | A second path shape for one resource; the draft-only rule belongs in the status check, and a non-draft deserves a 409 rather than a 404 that hides that the version exists |
| `/{workflowId}/{version}` without `versions`                  | Shares a path slot with `/{workflowId}/versions` and every future sub-path                                                                                                 |
| Keep `?version=N` beside `/versions/{version}`                | Two URLs for one read; the alias would never be removed                                                                                                                    |

## Consequences

`workflow_versions` rows in `draft` status are now mutable and deletable. A query that assumes an
immutable version must filter on `status`. `hasDraft` and `draftCount` on the list become live. A
draft saved at runtime and a later `users/` file with the same `id`+`version` diverge with only a
boot log line to show it: the file is skipped until the draft is deleted or renumbered. Because
drafts' `sourceKey`s are not checked, a draft may share a `sourceKey` with another workflow; the
conflict surfaces only once a publish step exists. The HTTP contract gains five operations and five
documented error codes and loses `?version=N`, the registry a sixth code that no route reaches yet, the schema one migration,
and the panel a CodeMirror dependency. Reversing this means deleting draft rows, the routes and the
index; published data is untouched.
