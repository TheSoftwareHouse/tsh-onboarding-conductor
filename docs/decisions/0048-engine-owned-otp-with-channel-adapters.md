# 0048. The engine owns the one-time code; delivery channels are adapters

- **Status:** Accepted
- **Date:** 2026-10-06
- **Tags:** connectors, security, persistence, workflows
- **Supersedes:** —
- **Superseded by:** —

## Decision

The engine generates, stores and checks one-time codes itself. A single built-in
connector, `otp` (capability `otp_verification`), draws a six-digit code with
`crypto.randomInt`, stores only a salted SHA-256 hash in `otp_challenges` (one row per
onboarding and channel, migration `0029`), and compares with `timingSafeEqual`. A
correct code deletes the row. A provider is asked to deliver a code, never to decide
whether one is right.

`otp_verification` replaces `phone_verification` and `email_verification` in
`CONNECTOR_TYPES`. The `otp-verify` step type accepts only that capability and the
`sms` and `email` channels, and derives `config: { operation: 'send' | 'check',
channel }` on every declaration it emits; authors write no `startConfig` or
`checkConfig`. `twilio_verify` and the two `mock_*_verification` fixtures are removed.

A channel is an `OtpChannel` adapter (`channel`, `settingsFields`, `send`) registered
in `OTP_CHANNEL_COLLECTION`. The `otp` connector's `settingsSchema` is the
concatenation of every channel's `settingsFields`, so a channel's credentials are
stored on the `otp` row per 0001. A new channel is a new adapter, not a new connector
type. `SmsOtpChannel` sends through Twilio Programmable Messaging; `EmailOtpChannel`
sends through `SmtpConnector`.

Limits are fixed constants, not settings: a code lives 10 minutes, a challenge accepts
`MAX_ATTEMPTS = 5` checks and `MAX_SENDS = 5` sends. A send past `MAX_SENDS` is refused
before anything is written or delivered (`429 OTP_SEND_LIMIT_REACHED`). Each wrong code
bumps `attempts` with one atomic `UPDATE ... SET attempts = attempts + 1 RETURNING`,
and the fifth wrong code rejects with `ATTEMPTS_EXHAUSTED`, routing to `refused`.

## Context

`twilio_verify` delegated everything to Twilio's Verify API: code, storage, expiry and
check. That tied the only phone and email verification to one vendor and one product,
and left email without a real provider, since only a mock implemented it. Moving the
code into the engine makes both channels work the same way and lets any delivery
provider be swapped without touching the verification logic.

The cost of owning the code is that the engine now holds the secret and the attack
surface: brute force, replay and enumeration are its problem, not Twilio's.

## Alternatives

| Option                                                                           | Why not                                                                                                                     |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Keep a provider-owned verify API (Twilio Verify) behind `phone_verification`     | One vendor per channel, no email equivalent, and the code is invisible to the engine, so limits and audit cannot be uniform |
| One connector type per channel (`sms_otp`, `email_otp`)                          | Duplicates generation, hashing and limits per type; a new channel would need a new type and a new admin-panel group         |
| Store the code in plaintext                                                      | A database read would yield every live code; a salted hash costs one `createHash` call                                      |
| Per-challenge attempt counter incremented in application code (read, add, write) | Concurrent submits could overrun the limit; the single `UPDATE` makes the increment atomic                                  |

## Consequences

**The hash is not a defence against database access.** Six digits are one million
values; anyone who can read `otp_challenges` can brute-force a salted SHA-256 hash
offline in moments. This is accepted knowingly. The protection is the 10-minute TTL
and deletion on success, so a row that matters is rarely there, and 0001 already
treats database access as equivalent to credential access. The hash and salt exist so
a casual read, a backup or a log of the row does not show a usable code. The salt is
regenerated on every send. The code is never logged, audited or returned.

**Twilio Verify's fraud tooling is gone**, including its SMS-pumping guard and
per-number rate limiting. `MAX_SENDS` caps what one onboarding can spend, and
`MAX_ATTEMPTS` caps guessing against one code. There is no per-number or per-IP
throttle across onboardings, so an attacker who starts many onboardings can still pump
SMS. That is a known gap, not a solved problem; closing it needs a throttle keyed on
the recipient or client address, which this record does not design.

The limits are not configurable per workflow. Changing one is a code change.

SMS credentials (`twilioAccountSid` and friends) live on the `otp` connector's stored
settings, all optional, because a deployment using only email must not be forced to
configure Twilio. An SMS send without them fails with `503 CONNECTOR_NOT_CONFIGURED`
at execute time, as 0001 describes.

Reversing this means reintroducing a provider-owned verify adapter, a new capability
or a revived `phone_verification`, and a migration dropping `otp_challenges`; no
deployed data depends on it today.
