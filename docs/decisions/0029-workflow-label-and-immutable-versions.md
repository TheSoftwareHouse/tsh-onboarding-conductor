# 0029. Workflow label on the family row, `workflows.key` as the identity, stored versions immutable

- **Status:** Accepted
- **Date:** 2026-09-28
- **Tags:** persistence, workflows, typeorm, migrations, api
- **Supersedes:** [0028](0028-identity-and-version-tables.md), its document-name decision only
- **Superseded by:** [0034](0034-admin-authored-workflow-drafts.md), its immutability rule for `draft` versions only

## Decision

A workflow document may declare a root `name`, and the engine keeps it as the family's display
label in `workflows.name`, beside the identity column, which is renamed `workflows.key`. `key`
holds the document's `id`, exactly as `agreements.key` holds an agreement family's; `name` is
nullable, is written from the highest stored version that declares one, and resolves nothing.

A stored workflow version is immutable. The startup publish inserts a revision it has not stored
yet and leaves a stored one alone when the file still matches the row; a file whose definition
differs from the row stored under its `id` and `version` fails the boot with
`WorkflowVersionConflictError`, naming the id, the version and the file. Nothing updates
`workflow_versions.definition` in place any more: a change ships as a new version.

`GET /v1/admin/workflows/:workflowId` and the compile dry run report the label as a nullable `name`
on `WorkflowDefinitionResponseDto`. The admin panel's types carry it; no screen renders it yet.

This record replaces the third decision of 0028 — "the document's `id` became `workflows.name`; the
document's `name` was deleted" — and nothing else in it. The identity/version split and the absence
of `workflows.current_version_id` stand.

## Context

0028 deleted the document's `name` because two revisions of one family declare different labels
(revision 2 of the EU workflow appends "(specialized steps)"), the in-place upsert had no defensible
rule for which label the identity row should carry, and nothing read the field. The label is wanted
back on the document and in the admin API, stored when a file is ingested; and a file is now read
as one version of a workflow — looked up by its `id`, added as a new version when the workflow
exists, refused when that version already does, created together with its family when nothing
does. Once a version is created exactly once, the ambiguity 0028 deleted the label over is gone:
"the label of the highest stored version" is one stable answer, and re-reading the shipped files on
every boot changes nothing. Immutability also closes a gap of its own — an onboarding is pinned to a
version row for its lifetime, and the in-place upsert let a file edit rewrite that row under it.

Keeping the identity in a column called `name` while storing a label called `name` beside it would
have made the collision that raised the question permanent. `agreements` already calls the same
thing `key`.

## Alternatives

| Option                                                       | Why not                                                                                                                                                                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Label on `workflow_versions`, one per revision               | Unambiguous, but the family then has no name of its own and a list of workflows has to reach through the latest version to title a row; agreements, whose versions carry no content, have no counterpart for it |
| Require every version of a family to declare the same `name` | Old version files can never be edited under immutability, so a family could never be renamed                                                                                                                    |
| Throw whenever the version row already exists                | The shipped files are re-read on every boot, so every boot after the first would fail                                                                                                                           |
| Keep updating a changed revision in place                    | The behaviour being removed: it lets a file edit rewrite the definition an in-flight onboarding is pinned to                                                                                                    |
| Keep the identity column as `workflows.name`                 | Leaves `name` meaning the identifier on one table and a label on the other                                                                                                                                      |

## Consequences

Editing a shipped or user workflow file without bumping its `version` fails the engine's boot with
an error naming the id, the version and the file. On a development stack whose Postgres volume
outlives the engine this is the common case after any fixture edit: `pnpm stack:reset` discards the
stored rows, or the change takes a new version. Concurrent boots stay safe — a revision is inserted
with `ON CONFLICT DO NOTHING`, so two instances publishing the same new file do not fail each other.

The document contract gains an optional root `name` of 1 to 200 characters in both the authored
and the compiled schema, and every shipped `*.workflow.json` carries its label again. The identity
column rename reaches every raw SQL statement that named it — the e2e suites' seeding and clean-up
— and `OnboardingEntity.getWorkflowName()` becomes `getWorkflowKey()`. The HTTP contract changes in
one place, `WorkflowDefinitionResponseDto.name`, nullable. Migration `0013` is rewritten in place,
as 0028 rewrote it, because nothing deployed has run it.

Reversing the immutability rule is cheap — restore the `DO UPDATE` clause — but the label rule
leans on it: without it, which revision names the family becomes arbitrary again.
