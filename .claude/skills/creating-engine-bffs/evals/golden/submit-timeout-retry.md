# Retrying a submit after a client-side timeout

No. `POST /v1/onboardings/:id/submit` runs the step's connector chain inline and returns only when
it resolves, and the engine has no request-abort handling, so a call that timed out on the BFF's
side may already have applied the transition. A submit is therefore not idempotent, and re-sending
it after a timeout risks running the connectors — and moving the onboarding — twice.

The correct move is to re-fetch `GET /v1/onboardings/:id/state` and continue from whatever it
reports: if the step advanced, render the next one; if not, the customer can submit again.

The timeout itself was too small for a KYC step. There is no engine-side budget to inherit: each
connector's own timeout is capped at 30 000 ms, a slot may spend up to 20 000 ms waiting between
retries, and a step may hold several slots in order, so the number is BFF policy — derive it from
the slowest configured workflow's chain, start at 60 s (`ENGINE_REQUEST_TIMEOUT_MS=60000`), and
configure it explicitly rather than accepting a default `fetch` timeout. A client-side timeout
surfaces to the BFF's own caller as the BFF's `502`, like any other transport failure, not as a
`504`.
