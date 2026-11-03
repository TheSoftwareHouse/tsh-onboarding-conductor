# Status mix and rejection reasons

All time, all workflows (assumed): 46 onboardings. Source: `onboarding_stats` grouped by `status`,
then by `rejectionReason` with `status` filtered to `rejected`.

| Status                 | Count |
| ---------------------- | ----- |
| awaiting_user          | 17    |
| rejected               | 12    |
| approved               | 11    |
| awaiting_manual_review | 4     |
| invalid                | 2     |

11 of 46 onboardings are approved (about 24 percent, computed from the two counts). That is not a
conversion rate to judge yet: 21 onboardings (17 awaiting_user, 4 awaiting_manual_review) are still
open, so only 25 have reached a final outcome. Of those 25, 11 were approved, 12 rejected and 2
marked invalid.

Why the 12 rejected were rejected (`onboarding_stats`, `status` = `rejected`, grouped by
`rejectionReason`):

| Rejection reason   | Count | Meaning                                                    |
| ------------------ | ----- | ---------------------------------------------------------- |
| CONNECTOR_REJECTED | 4     | the identity provider's verdict refused the applicant      |
| ATTEMPTS_EXHAUSTED | 2     | five wrong email verification codes                        |
| (none)             | 6     | no reason code: a score threshold or a reviewer's decision |

A rejection by a score rule or by a reviewer carries no reason code, so the six `(none)` rows are
those two kinds; which rule fired is a question for the workflow version (`get_workflow_version`).

Caveats: the groups are small (2 to 6 onboardings each), so these are counts, not rates to
extrapolate. Each `onboarding_stats` call reads the engine's CSV export, which the engine audits as
an export under your account, and the rows are reused for about five minutes.
