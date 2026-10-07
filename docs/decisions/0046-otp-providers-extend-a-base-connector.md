# 0046. Each OTP provider is a connector extending one base class

- **Status:** Accepted
- **Date:** 2026-10-07
- **Tags:** connectors, security, persistence, workflows
- **Supersedes:** [0045](./0045-engine-owned-otp-with-channel-adapters.md)
- **Superseded by:** —

## Decision

The engine still generates, stores and checks one-time codes itself, exactly as 0045
decided: a six-digit code drawn with `crypto.randomInt`, only a salted SHA-256 hash stored
in `otp_challenges` (one row per onboarding and channel), compared with `timingSafeEqual`,
deleted on a correct code. A provider is asked to deliver a code, never to decide whether
one is right. The limits are unchanged fixed constants: a 10-minute lifetime,
`MAX_ATTEMPTS = 5` checks and `MAX_SENDS = 5` sends per challenge.

What changes is where a provider lives. That logic sits in the abstract
`BaseOtpConnector`, and every provider is its own `otp_verification` connector extending
it: a subclass names its `id` and its one `channel`, declares the `settingsSchema` it
reads, and implements `deliver(recipient, code)`. The single `otp` connector, the
`OtpChannel` port and `OTP_CHANNEL_COLLECTION` are removed. The engine ships
`twilio_sms_otp` (Twilio Programmable Messaging, settings `accountSid`, `authToken`,
`messagingServiceSid`, all required) and `smtp_email_otp` (through `SmtpConnector`, no
settings of its own).

A workflow binds a provider by id on its `otp-verify` step. Switching provider is an edit
to that id; failing over is the declaration's existing `fallback` chain and
`errorHandler`. A declaration whose `channel` is not the connector's own fails at startup.
Challenges stay keyed by onboarding and channel, not by connector, so a check finds a code
that any provider of the channel delivered, and the send count caps a channel's spend
across every provider in the chain.

## Context

Under 0045 a provider was a channel inside the `otp` connector, so one deployment had
exactly one provider per channel, chosen in code. Two needs did not fit: changing a
workflow's provider without a code change, and falling back to a second provider when the
first cannot deliver. The connector layer already provides both for every other capability
— a declaration names an adapter by id, and a `fallback` chain with a pluggable error
handler decides what happens on failure — so the provider has to be a connector to use
them.

## Alternatives

| Option                                                   | Why not                                                                                                                               |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Keep 0045's channels, select one per declaration         | Re-implements id lookup and failover inside one connector; the fallback chain, error handlers and audit rows would not apply          |
| One connector per provider, each with its own code logic | Duplicates generation, hashing and limits per provider — the duplication 0045 rejected                                                |
| Key challenges by connector id                           | A code sent by a fallback could not be checked by the primary, and each provider would get its own send budget, multiplying SMS spend |

## Consequences

Adding a provider is one subclass registered in `ConnectorsModule`, with its credentials
on its own `connectors` row and its own audit trail. The admin panel lists each provider
that declares settings as its own connector.

Workflows name a provider rather than a generic `otp`; a workflow moved to another
provider is a document change and, for a published workflow, a new version.

The security consequences of 0045 stand unchanged: the hash is no defence against
database access, and there is still no per-number or per-IP throttle across onboardings.
A channel's send budget is now shared across providers, so a fallback does not raise what
one onboarding can spend.

Reversing this means reintroducing a channel registry inside a single connector and moving
each provider's settings back onto one row; no deployed data depends on it.
