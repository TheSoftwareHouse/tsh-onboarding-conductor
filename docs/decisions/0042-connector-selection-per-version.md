# 0042. A connector selection covers the published versions it was saved for

- **Status:** Accepted
- **Date:** 2026-10-13
- **Tags:** workflows, connectors, admin-panel, persistence, api
- **Supersedes:** [0038](0038-runtime-connector-selection.md) (selection scope only)
- **Superseded by:** —

## Decision

**A selection is a row per workflow version and step.** `workflow_connector_selections` gains
`version` (`INTEGER NOT NULL`, checked `> 0`) and its primary key becomes
`(workflow_id, version, step_name)`. The foreign key to `workflows` is unchanged; there is none to
`workflow_versions`, because only published versions get rows and those are never deleted.
Migration `0032` expands each existing family-wide row into one row per `published` version, then
drops the originals. It does not match the step against the stored document: a row names a compiled
step (an `otp-verify` step's `<name>_verify`), which the document does not list, and a version
without the step ignores the row. Every onboarding on a published version runs the connector it ran
before.
`down` keeps the highest version's row per step and loses the rest.

**Reads are per version, and a draft never gets a selection.** `WorkflowRegistryService.toWorkflow`
loads only the resolved version's rows, and passes none for a `draft`, so a draft shows its authored
connector and publishing it runs that connector, whatever the family had selected. A `retired`
version keeps its rows and projects them; resolution still refuses to run it.

**`scope` is required on both writes.** `PUT` takes `{ connectorId, scope, version? }` and
`DELETE` takes `?scope=&version=`; `scope` is `version` or `all`
(`CONNECTOR_SELECTION_SCOPES`), and `version` is a positive integer exactly when `scope` is
`version`. A missing or unknown `scope`, a missing `version`, or a `version` with `scope: all` is a
`400 VALIDATION_ERROR`; there is no implicit default.

- `version` covers that version only: a missing revision is `404 WORKFLOW_NOT_FOUND`, a `draft`
  `409 WORKFLOW_VERSION_NOT_PUBLISHED`, a `retired` one `410 WORKFLOW_RETIRED`, and a version without
  the step `404 WORKFLOW_STEP_NOT_FOUND`.
- `all` covers the **covered set**: every non-retired published version whose step of that name has
  exactly one connector. No such version declares the step: `404 WORKFLOW_STEP_NOT_FOUND`. Some do
  but none qualifies: the refusal comes from the rules (`multiple_connectors`, or `no_connector`)
  for the highest of them. `DELETE` with `all` leaves rows on retired versions.

**Validation covers the targets only.** `ConnectorSelectionRules` judges each target in ascending
version order, the first refusal throws with its `workflowVersion`, and nothing is written unless
every target accepts. A draft is never validated, so one that would refuse blocks nothing. The write
takes the advisory lock `${workflowId}:${stepName}`, per family and step, so a one-version and an
all-versions save serialize, and upserts one row per target in one transaction.

**The projection says what each version runs.** `selected` and `id` describe the viewed version
only. The primary connector of a selectable step also carries
`versions: [{ version, id, authoredId, selected }]`, ascending: the covered set, plus the viewed
version when that is a draft or a retired one. It is `[]` for a step a selection cannot address and
in the compile response. `PUT` answers with the slot as `describeForAdmin` projects it for the
target version, the highest covered one for `all`.

**The audit row says which versions changed.** The actions stay `workflow.connector_selected` and
`workflow.connector_selection_cleared`, one row per write, with metadata
`{ workflowId, stepName, connectorId, scope, versions: [{ version, previousConnectorId }] }`. The
allowlist still reads `previousConnectorId`, so rows written before this change come back as they
were.

**Publishing warns and does not copy.** `WorkflowDraftsService.publish` neither copies, reads nor
validates selections. The panel's publish dialog reads the draft's own definition and, for each
primary connector, notes the versions whose selected connector differs from the draft's authored one
("Step `submit_kyc` runs sumsub_kyc on v1, v2 (selected). v3 will run its authored veriff_kyc.").
The note is informational and never disables Publish.

## Context

[0038](0038-runtime-connector-selection.md) keyed a selection by family and applied it to every
stored version, and rejected a selection per version because the operator would repeat the choice
for each version still running. Publishing then showed the cost of that scope: a new version
inherited whichever connector the family had selected, so a draft's Graph tab (its authored
connector) disagreed with what it ran once published, and an operator who published a version to
change its provider found it still on the old one. Operators also had no way to switch one version
and leave the others.

## Alternatives

| Option                                                     | Why not                                                                                                                                       |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| A cutoff column: the family's row applies from version N   | A boot file ingest can add a version below N, and one cutoff cannot say "v1 and v3, not v2"                                                   |
| Keep the family-wide row, and let a version opt out        | Publishing would still inherit it, which is the defect; an exclusion list is a per-version row stored the other way round                     |
| An implicit `all` when `scope` is absent                   | A client written for the old contract would silently rebind every version; a required `scope` makes the reach visible in each request and 400 |
| Copy the family's selection into a newly published version | Publishing would read and write selections and could refuse over a connector the draft never named; the note tells the operator instead       |

## Consequences

An operator who wants one provider on every version saves with `all` again after publishing a new
one; the dialog's note says when that is needed. `all` is a snapshot of the covered set at save
time, so a version published later is not in it. A `PUT`/`DELETE` without `scope` now fails with
`400`, which breaks any client written against 0038's body. A retired version keeps a row nothing
can clear, since the writes refuse retired versions; it is harmless and stays readable.

> **Amends [0038](0038-runtime-connector-selection.md):** its "row per workflow family and step", "every
> stored version that has the step", "validates against every non-retired version" and "Selecting the
> authored id ... pins the choice family-wide" are replaced here. Its rules object, the persisted park,
> the `callbackFields` guard and the stale-row behaviour stand.
