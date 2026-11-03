# Parked onboardings and a reconcile preview

`review_queue` shows 4 onboardings parked on `mock_async_callback_2` at step `check_identity` (status
`awaiting_user`, no callback received): {{manifest:parked-awaiting-02}} (the oldest parked),
{{manifest:parked-awaiting-03}}, {{manifest:parked-awaiting-01}} and {{manifest:parked-awaiting-04}}.

I called `reconcile_pending_connector` for {{manifest:parked-awaiting-02}} without a token. That changes
nothing; it only returns this preview:

- Status `awaiting_user`, step `check_identity`, risk 0
- Pending connector `mock_async_callback_2`, parked since the time `parkedSince` gives
- Effect: the provider is asked for the verdict it already holds, and if it has one the engine applies it to
  this onboarding exactly as its callback would have, which can move it forward, including into manual review
  or a terminal status. The engine records the action in its audit trail under your name.

The confirmation token is valid for five minutes and for one use. Shall I go ahead with
{{manifest:parked-awaiting-02}}? I will only run it once you say yes. If the provider has no verdict yet the
result is `still_pending`, which is normal and leaves the onboarding parked.
