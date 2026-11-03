# Oldest onboarding awaiting manual review

The oldest in the queue is {{manifest:review-waiting-01}}: workflow `analyst-investigation` version 1,
status `awaiting_manual_review`, current step `review_identity`.

**How it got here.** The applicant moved through collect_profile, the email code, the document upload and
check_identity. At check_identity the provider's callback was applied with status accepted and
`providerVerdict` = `review`, and the engine moved the onboarding into manual review. The timeline shows no
reviewer decision after that, so it is still waiting for one.

**Signals available to me.** Risk score 0: no scoring rule fired, well below the 60 rejection threshold at
collect_profile. No rejection reason. Masked record: age band, nationality and country as given, source of
funds and the PEP declaration as given, the email and phone shown only as pseudonyms (`email:…`, `phone:…`)
and the provider verdict `review`.

**What the reviewer has to open.** First and last name, street, town and post code, the occupation title and
the identity document are withheld here and are listed only by label; the reviewer sees them in the admin
panel. The reason the provider asked for a human look is not in the data I can read, so that has to be read
off the document and the provider's result there.

**Is it safe to approve?** I can't say that. Whether to approve, reject or mark it invalid is the reviewer's
decision, made in the admin panel; nothing here can record it. What I can say is that the risk score is 0
and the only thing that put it in the queue is the provider's `review` verdict.
