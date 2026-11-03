# Admin access, exports and configuration changes, last 90 days

## 1. Scope and period

Period: the 90 days up to the day of retrieval, in UTC, with the from and to dates written out.
Scope: the whole instance; every actor. Assumption: "last 90 days" read as 90 days ending now.

## 2. Sources

- `access_report`, from and to as above, no actor filter, retrieved at the time the session reports.
  The retrieval is itself audited and appears in the window.

## 3. Summary

The audit trail records admin access in the period, all of it as `auth.access_unauthenticated` by
actor `anonymous` / `unknown`: admin sign-in was switched off, so no operator is identified for any
access, and in a deployed environment that is itself a finding. `onboardings.exported` entries are
listed below. No read was truncated (`truncated` is false) / the truncated parts are named.

## 4. Findings

Access by actor and outcome

| Actor type | Actor id | Outcome                     | Count                 | First           | Last            |
| ---------- | -------- | --------------------------- | --------------------- | --------------- | --------------- |
| anonymous  | unknown  | auth.access_unauthenticated | (count from the tool) | (from the tool) | (from the tool) |

Exports: each `onboardings.exported` entry with its time, actor (`operator` / `unknown`) and filters,
and the total from `count`. Some may come from the assistant's own reads of the export.

Configuration changes: the entries `configurationChanges` returned, or "no configuration entries
were recorded in the period" - never "no configuration changes were made".

## 5. Limitations

- The audit log is not cryptographically tamper-evident (its hash columns are unused), and some
  observations are best effort.
- Manual review decisions are recorded as actor `system` / `engine`; no reviewer is identified.
- Admin access names an operator only when admin sign-in is on; with it off the log shows anonymous
  access, as here.
- Exports include the assistant's own reads: `onboarding_stats` and `get_onboarding` read the CSV
  export and the engine audits each as `onboardings.exported` under the analyst.
- Truncation: stated per part, as above.

## 6. Appendix: tool calls

1. `access_report` with from, to; returned the access, export and configuration sections,
   `truncated` false.
