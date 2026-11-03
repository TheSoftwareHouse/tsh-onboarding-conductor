# Why {{manifest:parked-awaiting-01}} is stuck

**It is parked on the identity provider, waiting for a callback that has not arrived.** The status is
`awaiting_user` at `check_identity`, with a pending connector, `mock_async_callback_2`. Parked is not a
status of its own. The timeline shows the applicant's document submitted, the move into
`check_identity`, and then the engine parking there; no callback event follows. The applicant has
nothing to do; the provider's callback, or a reconcile by an operator, continues the onboarding. The
risk score is 0, so no scoring rule is involved. The pending connector's `parkedAt` gives how long it
has waited.

I can ask the provider for the verdict it already holds with `reconcile_pending_connector`. This is
the preview, and nothing has changed yet:

- onboarding: {{manifest:parked-awaiting-01}}, `awaiting_user` at `check_identity`
- pending connector: `mock_async_callback_2`, parked since the time the preview gives
- effect: asks the provider for its verdict and applies it as the callback would have; the engine
  records it in the audit trail under your name

Shall I go ahead? I will only run it after you say yes. The result can be applied, still pending
(the provider has no verdict yet) or superseded (the callback arrived first).
