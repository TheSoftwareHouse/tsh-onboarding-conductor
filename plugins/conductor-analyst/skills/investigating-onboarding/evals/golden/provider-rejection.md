# What happened to {{manifest:verdict-reject-01}}

**The identity provider rejected it, not the scoring rules.** The applicant passed the profile step
with a risk score of 0, far below the 60 threshold, and then the email code check and the document
upload. At `check_identity` the engine called the connector `mock_async_callback_2`, which parks the
onboarding until the provider answers. The timeline shows the move into `check_identity` and the park,
then a provider callback applied with a rejected outcome and the reason `CONNECTOR_REJECTED`, and in
the same moment the move to `rejected`.

The workflow version it ran (`analyst-investigation`, version 1) routes the `rejected` port of
`check_identity` straight to the `rejected` step, so a provider refusal ends the onboarding with no
review. The onboarding's rejection reason is `CONNECTOR_REJECTED`.

What cannot be seen: the code says the provider refused the applicant, and nothing more. The
provider's own reasoning is not in the tool output, and the applicant's name, address and document
are masked or withheld. The status is final; nothing moves it on.
