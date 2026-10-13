# 0038. An operator selects a step's connector at runtime; the park is persisted

- **Status:** Accepted
- **Date:** 2026-10-05
- **Tags:** workflows, connectors, admin-panel, persistence, api
- **Supersedes:** —
- **Superseded by:** —

## Decision

**A selection is a row per workflow family and step.** `workflow_connector_selections`
(`workflow_id`, `step_name`, `connector_id`, `updated_at`, `updated_by`; primary key
`(workflow_id, step_name)`, `workflow_id` a cascading foreign key) holds the connector an operator
bound to a step. `Workflow` applies it by replacing the `id` of the step's primary connector in
every stored version that has the step (`applyConnectorSelections`); the declaration's `config`,
field mapping, retry and error handler are the authored ones. Only a step with exactly one connector
declaration is selectable, and only its primary: a step with several slots is refused
(`multiple_connectors`) because the key cannot name a slot, and fallbacks are never touched.
`WorkflowRegistryService.toWorkflow` reads the family's rows on every resolution, so execution,
callback resolution and the admin projection see the same effective binding. There is no cache, as
for connector settings. Selecting the authored id stores a row too: it pins the choice family-wide,
and the authored id differs between versions. Only `DELETE` clears it.

**One rules object serves the read and the write.** `ConnectorSelectionRules`
(`workflows/domain/connector-selection.ts`), built by the registry from the execution port and the
active scopes, is the single statement of which adapter may serve a slot: the admin projection's
`selectableIds` is every id its `refuse` lets through for the step as authored, plus the authored
and effective ids, and the selection write throws on its first refusal. The projection is therefore
what a save accepts for that version; a multi-connector step projects `[]`, a fallback's id is never
offered, and a candidate whose declaration rules throw is left out. The two were separate before —
the projection filtered on type and callback support only — and offered ids the write always
refused.

**Saving validates against every non-retired version that has the step.** The first refusal wins and
names its version. `PUT /v1/admin/workflows/{workflowId}/steps/{stepName}/connector` answers
`400 WORKFLOW_CONNECTOR_SELECTION_INVALID` with a `reason` and `404 WORKFLOW_STEP_NOT_FOUND`; the
reasons are `no_connector`, `multiple_connectors`, `in_fallback_chain` (the id already serves the
step as a fallback), `adapter_not_registered`, `fixture_not_allowed`, `type_mismatch`,
`async_unsupported` (the slot is async and the adapter cannot answer by callback),
`callback_fields_missing` and `declaration_invalid` (the adapter's `validateDeclaration` threw for
the step as authored). The write takes an advisory lock per family and step, upserts, and is audited
after the commit as `workflow.connector_selected` or `workflow.connector_selection_cleared`.
Fixture adapters are hidden from the selectable ids and refused when `NODE_ENV=production`, as
fixture workflows are not loaded there.

**The registry reaches adapters only through the execution port.** `ConnectorExecutionPort` gains an
optional `listAdapters()` returning `{ id, type, supportsAsyncCallback, scope, callbackFields }`
per registered adapter. The adapter collection is not exported from `ConnectorsModule` and the
workflow and connector modules already `forwardRef` each other, so the port token is the one seam
that does not add a provider cycle.

**An adapter declares the fields it reports.** `ConnectorAdapter.callbackFields` lists the
`submittedData` keys an asynchronous adapter's callback may emit. The registry's definition
normalization refuses a step whose async connector lacks one of them in `data` (a boot failure
named like a declaration defect), and the selection service applies the same check per version. It
stops the stored Sumsub revision 1, which does not declare `kycAttemptCount`, being switched to
Veriff and losing a retry verdict; typed KYC steps always pass. Both revisions of the shipped Veriff
family carry Sumsub's `levelName` and `questionnaireDefinitionId`, inert for Veriff, so the family
can be switched to Sumsub and back; the Sumsub revision 1 to Veriff stays refused, as accepted here.
Letting the operator edit the connector config on a switch is the intended follow-up, and until then
keys the new provider ignores may remain in a declaration.

**The park is persisted.** `onboardings.pending_connector` (plain `jsonb`, not encrypted) holds
`{ connectorId, connectorName, connectorOrder, providerReference? }`. The executor copies a string
`providerReference` from the adapter's accepted result into the pending outcome; `Workflow` carries
it in the next state when a step parks and sets it to `null` on every other transition.
`AwaitingCallbackConnectorResolver` prefers it: a callback must name `pending.connectorId`, the slot
is found by `pending.connectorOrder`, and the connector is the chain link with that id or, when the
primary has been switched since, the slot's primary with its `id` replaced by the parked id. The
park is the only correlation source: a row without one resolves to nothing, and the
flattened-chain match this record first kept for rows parked before the column existed is gone
([0039](0039-parked-onboarding-lifecycle.md)). The admin onboarding summary exposes
`{ connectorId, connectorName, connectorOrder, parkedAt }`; the reference never leaves the engine.

**A superseded session cannot decide.** When the parked record carries a `providerReference` and a
parsed event carries a different one, the KYC kernel acknowledges and re-parks without applying
anything. Sumsub's reference is its stable applicant id, so the guard never fires for it; for
Veriff it drops the late decision of an abandoned session.

**Stale and dry-run behaviour.** The compile dry run ignores selections. A row naming an adapter
this build does not register, or hides in this environment, logs a warning per row at boot and fails
loudly when the step executes; it never falls back to the authored provider.

## Context

Workflow versions are immutable ([0029](0029-workflow-label-and-immutable-versions.md)), so the
provider a KYC step uses was fixed by whichever version an onboarding started on. The goal of the
Veriff work was to let an operator move a flow from Sumsub to Veriff, or back, from the admin panel
without publishing a version and without touching the rest of the document. The parked connector was
also held only in memory, in the executor's result for the request that parked: a restart lost it,
and nothing could tell, after a switch, which provider an onboarding was actually waiting on. Both
had to change together, or a switch would strand every onboarding already waiting on the previous
provider.

## Alternatives

| Option                                                  | Why not                                                                                                                                                                     |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Publish a new workflow version for each switch          | Versions are immutable and numbered per family; a provider toggle would burn a version each time, leave older versions on the old provider, and make switching back a third |
| A selection per version                                 | The authored id differs between versions and a started onboarding stays pinned to its own, so an operator would repeat the choice for every version that is still running   |
| Cache selections in memory                              | A second engine instance would run the old provider until its cache expired; connector settings are already read per resolution                                             |
| Rewrite the connector `id` in the stored JSON           | Breaks immutability and the drift check at boot, and loses what the document authored; the file loader would fight the edit                                                 |
| Keep the park in memory                                 | A restart or a switch loses which provider the onboarding waits on, so its callback cannot be matched to anything                                                           |
| Key the selection by slot order                         | `order` is a position inside a version's step; a selection must survive versions that reorder or add slots                                                                  |
| Fall back to the authored provider on a stale selection | An onboarding would run on a provider nobody chose and the callback would never match; failing loudly makes the cause visible                                               |

## Consequences

The registry does one more read per resolution. A retired version still projects the effective id
but never runs, since resolution refuses it; saving does not validate against it, so a selection can
make a retired version's projection name an adapter that version would have refused.

A hand-written step that lacks a field the adapter reports cannot be switched to it
(`callback_fields_missing`) until the document is republished with the field. The warning for a
stale row appears only at boot, so a row made stale while the engine is running surfaces at
execution.

The selection reaches the audit log under a new resource type, `workflow`, so the panel's Logs page
gets a "Workflows" tab without a change of its own and links each such row to the workflow's details
page. The admin read grows additive fields ([0033](0033-admin-workflow-details.md)). An onboarding
parked on the previous provider finishes with it; one parked before the column existed no longer
resolves at all, since [0039](0039-parked-onboarding-lifecycle.md) made the park the only
correlation source. Reversing the decision means dropping the table and the column; no stored
document is changed by it.

> **Amended 2026-10-08 in place:** the selection rules object (`ConnectorSelectionRules`) now serves
> both the admin projection and the save, and the built-in Veriff flows carry Sumsub's keys unused so
> the shipped family switches in both directions.
>
> **Amended 2026-10-08 by [0039](./0039-parked-onboarding-lifecycle.md):** the persisted park is the
> only correlation source for a callback — the flattened-chain match for a `NULL` park is gone — the
> park records `parkedAt`, and the admin summary exposes it.
