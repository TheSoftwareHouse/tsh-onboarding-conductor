# 0021. The admin panel issues manual-review decisions, gated by the workflow definition

- **Status:** Accepted
- **Date:** 2026-09-22
- **Tags:** admin-panel, workflows, security, audit
- **Supersedes:** —
- **Superseded by:** —

## Decision

The redesigned onboarding details page (`/onboardings/:id`) can act on an onboarding, not
only display it. Approve, Reject and Mark invalid each call
`POST /v1/onboardings/{id}/review/{action}` — a route that already existed but had no
caller before this change. Which of the three buttons render is decided by
`findAvailableReviewActions`, reading the pinned workflow definition's current step: a
button appears only when that step declares the matching `manual.approve` /
`manual.reject` / `manual.invalid` transition, never by attempting the call and
recovering from a `409`. No definition, no current step, or a settled onboarding renders
none of the three.

This route carries no operator authentication today — it sits outside the admin bearer
guard, and the OpenAPI document's own tag description calls that "a known gap ... not a
design intent." The panel is built against that gap knowingly, not around it: a decision
recorded through this endpoint is attributed to no actor, and this record names that
plainly so it is not rediscovered as a surprise later. The panel does not invent an actor
header or any other client-side compensation for the missing guard.

The same page becomes a tabbed view (History, Scores) rather than one static column, and
its Collected-data tab is deliberately not built: `GET /v1/onboardings/{id}` is documented
as returning the record "without its collected data", so the design's PII sections,
masking, reveal, documents and KYC verdict have no data source to render from.

## Context

Before this change, the details page was read-only: a summary card, a scores card and a
React Flow drawing of the workflow state, with no way to act on an onboarding awaiting
manual review from the panel at all. The new design puts Approve / Reject / Mark invalid
directly on the page an operator is already looking at, so the natural question was
whether the panel should call the existing review endpoint or wait for the engine to gain
auth in front of it first. The user chose to build it now: the engine is explicitly out of
scope for this change ("change nothing in the engine"), and leaving the buttons out would
mean the design ships without the one action the page exists to support. Gating
availability by the definition, rather than by trial and error against the endpoint, was
chosen because the definition is already fetched for the page's score bounds and
names the legal transitions directly — there is no need to ask the engine
whether an action is possible when the workflow document already says so.

## Alternatives

| Option                                                                    | Why not                                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Render all three buttons always, let a `409` explain unavailability       | Shows an operator a control that does nothing for their onboarding, and a rejected click reads as a bug rather than as "not available here."                      |
| Add operator authentication to the review endpoint in this change         | An engine change, ruled out by this change's own scope; the endpoint's auth is a separate piece of work the engine owns.                                          |
| Withhold the review buttons entirely until the engine closes the auth gap | Leaves the redesigned page unable to do the one thing the design adds it for, over a gap the user chose to accept and record instead.                             |
| Build the Collected-data tab against a placeholder or partial projection  | The summary endpoint has no collected-data field at all; a placeholder would be fabricated data on a page whose other bands read only from what the engine sends. |

## Consequences

A review decision made through the panel today is unattributable to an operator in the
audit trail, until the engine closes the authentication gap on
`POST /v1/onboardings/{id}/review/{action}`. That is a known, accepted limitation, not an
oversight this record hides — anyone reading the audit trail for one of these rows should
expect no actor on it. Closing the gap is engine work outside this change; when it lands,
the panel needs no change of its own, since it already sends no actor header for this call.

Gating on the definition means the buttons can under-render if the definition fetch fails
or the pinned version is stale relative to what actually governs the onboarding — the page
already treats "no definition" the same as "no current step," so this shows as no buttons
rather than a wrong one.

The Collected-data tab stays absent until the engine exposes an onboarding's collected
data with field-level masking, a reveal endpoint and a `pii.revealed` audit action (tracked
as future engine work, not by this record). Until then, the panel shows no personal data at
all for an onboarding, which is the safer default of the two absences this change had to
choose between.
