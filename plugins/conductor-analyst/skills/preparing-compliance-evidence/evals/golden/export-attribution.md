# Who exported onboarding data in the last 90 days

The audit trail records the exports, but it cannot say whether anyone downloaded the data.

`access_report` for the 90 days up to retrieval lists every `onboardings.exported` entry with its
time and filters, and gives the total in `exports.count` (`listed` shows how many are itemised; the
rest are counted, not listed). The actor on each is `operator` with id `unknown`: admin sign-in is
off in this environment, so the engine cannot name the person, and the same period's access entries
are `auth.access_unauthenticated` by `anonymous` / `unknown`. No individual is named, because none
is recorded.

The entries cannot be separated into downloads and analysis. `onboarding_stats` and `get_onboarding`
read the engine's CSV export, and the engine audits each such read as `onboardings.exported` under
the analyst. Entries whose filter is a single onboarding id or a status or parked filter are
consistent with the assistant's reads, but the trail alone does not prove it; only the MCP server's
own call log can. So the honest statement for the auditor is: N exports are recorded (N from the
tool), actor not identified, origin (download or assistant read) not determinable from the trail.

Limits: the audit log is not cryptographically tamper-evident; if a read was truncated the counts are
a lower bound (otherwise state that none was); sign-in disabled means anonymous access is the
finding to raise.

Calls made: `access_report` (from, to); optionally `search_audit` with `action` `onboardings.exported`.
