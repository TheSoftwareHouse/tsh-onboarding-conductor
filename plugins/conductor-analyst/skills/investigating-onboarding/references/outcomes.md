# Step types, ports and outcomes

Read this when a timeline or workflow version shows a step or port the main skill does not explain.
It describes what the Conductor does; it is not a guide to authoring workflows.

## Statuses

| Status                            | Meaning                                                                                                                 |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `awaiting_user`                   | The onboarding is waiting for the applicant's next submission, or, with a pending connector, for a provider's callback. |
| `awaiting_manual_review`          | A person must decide at a manual review step.                                                                           |
| `approved`, `rejected`, `invalid` | Final. Nothing moves them.                                                                                              |

Parked is not a status: it is `awaiting_user` plus a pending connector.

## Steps, as the version lists them

Each step in `get_workflow_version` has a status, fields, `scoringRules`, `transitions` and
connectors. A transition names the port that fired (`success`, `rejected`, `manual.approve`,
`manual.reject`, `manual.invalid`), an optional `reason` list or `when` condition, and a target.
The first matching transition wins, so a conditional one listed before the plain one is the
exception to it.

- **Collect steps** (profile, address, questionnaire, contact details) gather answers and run
  their `scoringRules` on submit. A threshold is a `when` with `score` and `gte`, `gt`, `lte`
  or `lt` on a transition, usually to a final `rejected` step.
- **Code check steps** (one-time code by email or SMS) send a code, verify it and offer a resend.
  Attempts are budgeted by the provider; the wrong code that uses up the budget rejects with `ATTEMPTS_EXHAUSTED` (five tries in the mock provider). An expired
  or unknown code is `CHALLENGE_EXPIRED` or `CHALLENGE_NOT_FOUND`, which a version usually routes
  to a resend step rather than to rejection.
- **Document and identity steps** hand the applicant's document to a provider. Some providers
  answer at once; others park the onboarding until their callback arrives. An identity provider
  answers with an outcome the version routes on: verified, needs review, retry (the applicant
  may resubmit a part), or refused. A retry cap turns a retry into a review.
- **Manual review steps** wait for a person, who approves, rejects or marks invalid (`manual.*`).
- **Final steps** carry the outcome (`approved`, `rejected`, `invalid`).

## Reasons a connector can give

`ATTEMPTS_EXHAUSTED`, `CHALLENGE_EXPIRED`, `CHALLENGE_NOT_FOUND`, `CONNECTOR_REJECTED`. The
engine keeps a refusal's reason on the onboarding wherever the transition routes it, so a
rejection by score or by a reviewer carries no reason.

## Scores

A version declares its scores with bounds. Rules add a fixed number when a field test matches; the
timeline's `fromScores` and `toScores` show the change a submission made.

## Versions

An onboarding stays on the workflow version it started on. A newer published or draft version does
not change how it is routed, so an explanation always quotes the version in the timeline header.
