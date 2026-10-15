# 0043. Forking a version into a draft is a client-side copy

- **Status:** Accepted
- **Date:** 2026-10-14
- **Tags:** workflows, admin-panel, authoring
- **Supersedes:** —
- **Superseded by:** —

## Decision

**The panel forks a version; the engine does not change.** It reads
`GET /v1/admin/workflows/{id}/versions/{v}/document`, overwrites the document's `id`, `version`
and `name` (an empty name removes `name`), and sends it to `POST /v1/admin/workflows`. The engine's
`409`s (`WORKFLOW_SCOPE_CONFLICT`, `WORKFLOW_VERSION_EXISTS`, `WORKFLOW_DRAFT_EXISTS`) stay the
authority; the panel's checks only spare a pointless request.

- **The next version is `max(version of every listed version, any status) + 1`**, computed in the
  panel from the family's versions list.
- **Nothing records the source.** The draft is an ordinary `users` draft, as 0034 describes.
- **Built-in and fixture families are copied under a new ID** (0030). The ID starts empty and Version
  prefills to 1, since a new ID is a new family.
- **Both entry points use the one New draft modal.** The list's "New draft" opens it with no source
  chosen. The same "New draft" button on every published or retired version's details page opens it
  with that workflow and version preselected.

## Context

[0034](0034-admin-authored-workflow-drafts.md) deferred forking: it let operators author drafts
from an empty or uploaded document, and left starting one from an existing version for later.
[0041](0041-admin-workflow-documents-for-every-status.md) now serves the stored document of every
version, so the panel has what it needs to copy one.

## Alternatives

| Option                               | Why not                                                                               |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| An engine fork endpoint              | The panel already reads the document and creates the draft; a route would repeat both |
| An `origin` column naming the source | Rejected by 0034; it adds a migration and a stored link for lineage nothing reads     |

## Consequences

A draft carries no lineage: nothing says which version it was copied from. A copy carries connector
`config` verbatim into a new `users` draft, which 0041 already lets admins read.
