# What if the reject threshold of analyst-investigation went from 60 to 70

Sources: `get_workflow_version` (threshold: `risk` greater than or equal to 60 on the success
transition of `collect_profile` routes to `rejected`), `onboarding_stats` (46 onboardings on
version 1; 12 rejected; by status and by rejection reason) and `find_onboardings` (scores).

Of the 12 rejected onboardings, 4 were rejected by the score rule: their risk scores are 60, 70,
70 and 90. The others were rejected for other reasons (CONNECTOR_REJECTED 4, ATTEMPTS_EXHAUSTED 2,
and two with risk 0 that were rejected without a rejection reason code).

Raising the threshold to 70 would change the route of exactly 1 of them: the onboarding with risk
60 (country rule 40 + source of funds 20) would have continued to `send_email_code` instead of
being rejected. The three at 70, 70 and 90 are still rejected. No approved or in-flight onboarding
has a risk of 60 or more, so nothing else moves.

These figures are historical. A changed rule applies only to onboardings started after the
new version is published; it does not re-score or re-route onboardings already decided or in
flight. Nothing was changed or saved by this answer.
