# 0040. Operators publish a draft through a bodiless endpoint that compiles it under a global lock

- **Status:** Accepted
- **Date:** 2026-10-09
- **Tags:** persistence, workflows, admin-panel, api, authoring
- **Supersedes:** —
- **Superseded by:** —

## Decision

`POST /v1/admin/workflows/{workflowId}/versions/{version}/publish` flips a stored `draft` to
`published`. It follows [0034](0034-admin-authored-workflow-drafts.md), which left publishing out. It takes
no body and publishes what is stored, so the editor must have saved first. It answers `200` with the
version's identifiers, `status: 'published'`, `name` and timestamps, and no document.
`WorkflowDraftsService.publish` runs one transaction:

1. `WorkflowsRepository.lockPublishing` takes `pg_advisory_xact_lock` on the constant
   `'workflow:publish'` (through `hashtext`), so publishes run one at a time across every family. Two families
   therefore cannot both pass the connector `sourceKey` check. The lock is always taken before the
   row lock.
2. The draft row is locked: `404 WORKFLOW_NOT_FOUND` when absent, `409 WORKFLOW_VERSION_NOT_DRAFT`
   when it is in another status.
3. When a `published` version of the family is at or above this one, it answers
   `409 WORKFLOW_VERSION_NOT_LATEST`, carrying `workflowId`, `version` and `latestPublishedVersion`.
4. When a workflow file declares the same `id` and `version`, it answers
   `409 WORKFLOW_VERSION_EXISTS`. Startup skips that file while the row is a draft, but compares it
   with a published row and fails the boot when the two differ.
5. `WorkflowCompilationService.compile` runs on the stored document through the transaction's
   `EntityManager`, the same compile the dry-run route uses, so its single-error shapes
   (`400 WORKFLOW_INVALID`, `400 WORKFLOW_CONNECTOR_DECLARATION_INVALID`,
   `409 WORKFLOW_SOURCE_KEY_CONFLICT`) come back unchanged. An invalid document never enters the
   non-draft set that the boot sweep compiles.
6. `publishDraft` sets `status = 'published'` and `updated_at`, guarded by `status = 'draft'`.
7. The label follows 0029: when the document declares a root `name` of 1 to 200 characters and no
   non-draft revision of the family has a higher version, `relabelFamily` writes it to
   `workflows.name`. A draft never relabels (0034); a published version does.
8. `workflow_draft.published` is audited with `{ workflowId, version }` and no document, because the
   document can hold literal connector `config` values.

Publishing never changes another version's status. There is no pointer column and no migration: an
unpinned start still resolves the highest `published` version at query time (0028).

## Context

0034 deferred publishing and promised it would never retire other versions. A publish is the one write
that moves a document from a state the boot sweep skips to one it compiles, so an invalid or
`sourceKey`-conflicting document would fail the next boot unless the publish itself refuses it. The
compile has to read the other families' `sourceKey`s, and two concurrent publishes would each see the
other's family as still a draft. Serving an older version after a newer one would break the rule that
the highest published version is the one unpinned starts use.

## Alternatives

| Option                                       | Why not                                                                                                                               |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| A body-carrying atomic save-and-publish      | A second write path for the same document, and an irreversible action carrying an edit the operator may not have reviewed; save first |
| Retiring the previous published version      | Retiring is out of scope; the highest published version already wins at query time, and 0034 promised publishing never retires        |
| A current-version pointer column             | Needs a migration and a second source of truth; 0028's query-time resolution already serves the right version                         |
| A per-family lock instead of the global lock | Does not stop two families publishing the same `sourceKey`; publishes are rare, so serializing them all costs nothing                 |

## Consequences

Unpinned starts are served the new version immediately. The family label may change. The family has no
draft afterwards, so the next version is an ordinary draft create, and a published version cannot be
edited or deleted through the API. A draft numbered at or below a published version cannot be
published and must be renumbered, and so must one whose `id` and `version` a workflow file also
declares. The HTTP contract gains one operation and one documented error
code, `WORKFLOW_VERSION_NOT_LATEST`; the audit log gains one action; the schema is unchanged.
Publishing is the only place the `sourceKey` conflict 0034 deferred now surfaces. The advisory lock covers publishes only: the boot sweep that publishes workflow files (`publishFromFiles`) does not take it. Reversing this
means removing the route and the action; published rows stay as they are.
