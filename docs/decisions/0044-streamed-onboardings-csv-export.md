# 0044. `GET /v1/onboardings/export` streams every match as CSV, unbounded and audited

- **Status:** Accepted
- **Date:** 2026-10-05
- **Tags:** admin-panel, onboardings, api, audit, security
- **Supersedes:** —
- **Superseded by:** —

## Decision

A new admin route, `GET /v1/onboardings/export`, returns every onboarding matching the list's
filters (`status`, `workflowId`, `workflowVersion`, `currentStep`, `onboardingId`,
`agreementStatus`, `parked`, `pendingConnectorId`, `parkedBefore`) as `text/csv`, not one page of them. `page` and `limit` are not accepted. There is
no row cap: the engine reads in keyset batches of 5000 and streams each batch as it goes. The list
keeps its 100-row ceiling, so "an operator can never pull the whole table in one request" no longer
holds, and this record replaces that stance for this one route.

- **Contents.** One row per onboarding, in the list's order (`created_at DESC, id DESC`): the fixed
  summary columns, one `<Name> score` column per score, one column per collected field, then
  `Other data`. Every header label, fixed or not, is derived from its key by one rule with no hand-written labels or
  overrides: keys are split on case boundaries, `_` and `-` and sentence-cased (`onboardingId` becomes
  `Onboarding id`, `firstName` becomes `First name`), and labels may repeat. Collected data is the decrypted `context` (0024), so encryption at rest
  does not protect the file.
- **Columns come from workflow declarations, not stored data.** One query lists the distinct
  `(workflow key, version)` pairs in the filtered set, and each is resolved through the registry,
  `retired` revisions included (an export is a historical read, as in 0033). Score columns are the
  declared score names, sorted. Field columns are the persisted fields of each step, in step order
  across versions ordered by key then version, first appearance winning. `Other data` holds, as JSON,
  any context key no declared column covers, such as one a connector writes. A version that no longer
  resolves contributes no columns and its whole context lands in `Other data`; the export does not
  fail.
- **Encoding.** RFC 4180: comma separator, CRLF, a field quoted when it holds `"`, `,`, CR or LF,
  quotes doubled, a leading UTF-8 BOM. Dates are ISO 8601 UTC, `null` is an empty cell, objects and
  arrays are `JSON.stringify`'d. A string cell starting with `=`, `+`, `-`, `@`, TAB or CR gets a
  leading `'`; numbers are untouched.
- **Batching is keyset.** Each batch continues from the previous batch's last `id`, bound as
  `:lastId` in `(created_at, id) < (SELECT created_at, id FROM onboardings WHERE id = :lastId)`.
  Reads run outside a transaction, as the list does. Migration `0033` adds
  `idx_onboardings_created_at_id` on `onboardings (created_at DESC, id DESC)`, so each batch is an
  index range read in the list's own order. A batch reads agreement status from the view by its
  ids rather than joining it, since a join aggregates the whole view on every batch; only an
  `agreementStatus`-filtered export keeps the join.
- **Audit.** Every export writes one `onboardings.exported` row (operator actor, resource type
  `onboardings_export`) before the first byte. Metadata is the filter criteria supplied, never row
  data. Today only failed admin requests otherwise leave a trace.
- **Transport.** The response carries `Cache-Control: no-store` and a `Content-Disposition`
  attachment. A failure after the first byte cannot become an HTTP error, so the connection is
  aborted rather than ending the file early with error text in it.
- **Panel.** The Onboardings page header gets an outlined **Export CSV** button. It exports the
  committed filters (never the draft), without `page`/`limit`, through axios as a blob, because the
  bearer token comes from the axios interceptor and a navigation cannot send it. If the connection
  fails partway, axios rejects and nothing is saved; the failure is an error toast. The panel names
  the file `onboardings-<yyyy-MM-ddTHH-mm>.csv` itself and does not read `Content-Disposition`.

## Context

The Onboardings screen in the panel's design has an Export CSV button, and `docs/IMPLEMENTATION.md`
listed it as absent "for want of an endpoint". An operator wants every match for the applied filters,
with the collected data and scores, which the list cannot give: it pages, caps at 100 and carries
neither. The user chose an unbounded streamed export over a cap.

## Alternatives

| Option                                                           | Why not                                                                                                                                          |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| A row cap, refusing a larger result                              | The user chose unbounded; a cap would make the file answer "every match" only below some size the operator cannot see                            |
| The panel pages through `GET /v1/onboardings` and builds the CSV | Needs 100-row round trips, holds the file in the browser, carries neither `context` nor scores, and moves CSV encoding into the panel            |
| A header derived from the data (union of stored keys)            | `context` may be encrypted (0024), so SQL cannot list its keys; the header would need a second decrypting pass over the whole set before row one |
| Offset batching                                                  | Re-reads shifted rows while onboardings are inserted mid-export; keyset avoids it                                                                |
| Keyset cursor on the last row's `created_at` value               | A JS `Date` truncates Postgres' microsecond `timestamptz` to milliseconds, which would skip or duplicate rows; the cursor is the `id` instead    |
| An `<a href>` navigation to the route                            | A navigation cannot send the Entra bearer token the axios interceptor adds                                                                       |

## Consequences

An export is one long sequence of indexed batched reads; its load grows with the matching set, and
nothing in the engine bounds it. A client disconnect stops the batch loop, since `Readable.from` stops
pulling once destroyed. Personal data leaves the system decrypted, and the audit row records who and
which filters, not what. A version outside the active scopes shows its collected data only as JSON in
`Other data`. Labels are derived from keys and may repeat, so cells are positional. The panel buffers the whole blob in memory before saving it. An onboarding deleted
mid-export would end it early; none is ever deleted today. Export on the Logs and details pages, `.xlsx`
output, a column picker, cancelling from the panel and showing progress stay unbuilt.
