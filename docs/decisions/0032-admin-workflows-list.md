# 0032. `GET /v1/admin/workflows` lists every family the registry serves

- **Status:** Accepted
- **Date:** 2026-09-28
- **Tags:** admin-panel, workflows, api
- **Supersedes:** —
- **Superseded by:** [0034](0034-admin-authored-workflow-drafts.md), its statement that nothing in the engine writes `draft` only

## Decision

A new `GET /v1/admin/workflows` lists every workflow family the active scopes contain, ordered by
`workflows.key`, paginated like every other admin list, and filterable by `search` (case-insensitive
substring over `key` and `name`, `%`/`_`/`\` escaped), `scope`, and `hasDraft` (narrows to
`draftCount > 0` only when `true`). Each row is `workflowId` (`workflows.key`), `name`, `scope`,
`servingVersion` (the highest `published` version, or `null`), `versionCount` (every stored status),
`draftCount`, `inProgressCount` (onboardings on any version of the family with `completed_at IS
NULL`), `createdAt` and `updatedAt`. The route reuses `WorkflowRegistryService.getActiveScopes()`
rather than restating it, so production hides `fixtures` here exactly as it does on every other
workflow read; a deployment cannot list what it cannot otherwise reach. `workflow_versions
.definition` is never selected.

The admin panel's new `/workflows` page reads this route as a plain filtered list — search, scope
and "Has unpublished draft" committed through nuqs, 20 rows a page, no page-size control. `Serving`
renders "vN" or "Not served"; `Versions` renders the count plus a muted draft note. `Added` renders
`createdAt`'s date, with an "Edited {date}" line when `updatedAt` differs from it by date —
`updated_at` only moves on create or rename, so this is a coarse label, not a live "last touched"
timestamp; a reliable one is deferred (Improvements). A non-zero `inProgressCount` links to
`/onboardings?workflowId=<id>`, built by the same `workflowId` serializer the Onboardings filters
now share; that Onboardings filter has no "in progress" criterion, so the link also lists the
family's completed onboardings. The row's id and its trailing arrow both link to a placeholder
`/workflows/:workflowId` route that renders nothing — there is no versions endpoint yet, so there is
nothing for a details page to show. `draftCount` reflects rows in `draft` status; nothing in the
engine writes that status itself; today it only appears on a revision an operator or a test flips by
hand.

Dropped from the design, for want of a write API or a slot in the shared list chrome: Import JSON,
the New draft modal, and any publish, retire or scheduling action; the "24 workflows" count beside
the filter actions, since the shared footer's "Showing x–y of n" already states it.

## Context

The engine has never exposed a list of workflow families: `WorkflowsController` carries only
`GET /v1/admin/workflows/:workflowId` (one revision or the servable one) and
`POST /v1/admin/workflows/compile` (a dry run over an authored document). The Workflows screen in
the panel's new design needs one, and the earlier scope agreement (memory note, 2026-09-25;
confirmed with the user 2026-09-28) fixed this as a read-only page: no Import JSON, no New draft, no
publish/retire, and a details route that is a placeholder rather than the design's version-picker
page. [0029](0029-workflow-label-and-immutable-versions.md) already gives every family a stable
`key` and an optional `name` label to search and display, and [0030](0030-workflow-family-scope.md)
already gives every family exactly one scope, so a row needs no more than one scope value and one
name label each, both plain mono text rather than chips.

## Alternatives

| Option                                                                                                                   | Why not                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Widen `GET /v1/admin/workflows/:workflowId` to accept no id and return a list                                            | Two response shapes and two pagination behaviours on one route; every other admin list is its own paginated route                                           |
| Ship `GET /v1/admin/workflows/{id}/versions` in the same change, for a real details page                                 | Not needed yet — nothing in this change reads it; the details route stays a placeholder until a version picker is scoped                                    |
| Compute `inProgressCount` from a new "open" Onboardings status filter, so the In progress link matches its count exactly | A multi-status filter is its own admin-panel change with its own contract; deferred to Improvements, the link narrows by `workflowId` alone in the meantime |
| Let a family show one chip per version's scope, as the design draws "users + fixtures"                                   | 0030 already fixed one scope per family; there is only one value to show                                                                                    |

## Consequences

`fixtures` families stay invisible in production, matching every other workflow read; an operator
auditing them needs a non-production stack. The panel's Scope filter drops the `fixtures` option
there, reading the engine's `NODE_ENV` from `/config.js` as `VITE_NODE_ENV`; the API itself still
accepts `scope=fixtures` and answers it with an empty page. The In progress link
overstates its target list until Onboardings gains a multi-status filter — clicking it shows the
family's finished onboardings alongside the ones still running. `hasDraft=true` narrows to nothing
on any deployment where no revision was ever flipped to `draft` by hand, since the engine's own
publish path only ever writes `published`. A details page and its version history stay unbuilt
behind the placeholder route until `GET /v1/admin/workflows/{id}/versions` is scoped and built.
`listForAdmin` joins only unfinished onboardings (`completed_at IS NULL` in the join condition),
which migration `0028`'s partial index `idx_onboardings_in_progress_version` serves, so a list
request reads the in-progress rows of the active scopes rather than every onboarding ever stored.
It still aggregates every family before `LIMIT`; counting only the page's families is worth doing
once the catalogue outgrows a page.
