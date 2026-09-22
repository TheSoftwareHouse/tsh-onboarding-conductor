# 0021. Data-key rotation is lazy; the sweep serves only the encryption on/off toggle

- **Status:** Proposed
- **Date:** 2026-09-22
- **Tags:** encryption, security, onboardings, key-rotation
- **Supersedes:** 0020
- **Superseded by:** —

## Decision

Rotating the data key changes which key new writes use and nothing else. An existing
`onboardings.context` row stays on the key it was written with until it is next written, at which
point the column transformer seals it under whatever key is active then. There is no re-encryption
pass on rotation, neither for an operator's `POST /v1/admin/encryption/keys` nor for the scheduled
rotation of decision 7 below.

"Until it is next written" is narrower than it sounds, and the narrowness is part of the decision
rather than a defect to fix later. Live writes reach the row through `Repository.save()`, and
TypeORM diffs the _decrypted_ context against a freshly loaded copy, so a write that leaves the
plaintext unchanged issues no `UPDATE` for the column and the row keeps its old key id; a
`completed` onboarding refuses further submits and is never rewritten at all. A key therefore keeps
protecting every row created during its window that is never meaningfully changed again — which, as
a table ages, is most of them. Each key's slice is **bounded and never grows**. It is not
drained.

The background sweep stays, and serves the panel's on/off toggle only: it encrypts every stored
onboarding when an operator turns encryption on, and decrypts every one back to plain JSON when
they turn it off. Those two directions are what make the toggle mean what it says, and they remain
eager and exhaustive.

What 0020 decided otherwise stands and is restated here so this record can be read on its own:
`ENCRYPTION_KEY` is a key-encryption key that wraps the data keys in `encryption_keys` and never
encrypts a row itself; the envelope carries the id of the key that wrote it; whether encryption is
on is derived from the key table rather than a flag; every change takes effect one ring-refresh
interval later, so at most one key is active at any instant; nothing self-provisions; and the
active key carries its own automatic-rotation schedule, counted from its creation.

A full re-encryption of every row onto the active key — the one response to a data key whose
unwrapped material leaked — is **not built here**, and no endpoint offers it. It was available
before this record only as a side effect of `POST /keys`, and that side effect is what this record
removes. Restoring it deliberately is the named follow-up: the sweep derives its target purely from
the key table, so a one-off re-encryption needs stored intent — a requested-at column on the active
key that the sweep widens its sources for and clears when it drains — rather than an endpoint that
merely starts something.

Out of scope, and unchanged by this record: retired key material is still retained forever, and
destroying it is not pursued — see Alternatives for why it would achieve nothing; and KEK rotation
still does not exist.

## Context

Because the sweep re-encrypted every row onto each new key, the active key always protected every
stored onboarding. Rotation therefore never reduced how much data any single key exposes — the
property rotation exists to provide — while costing a full re-encryption of the table each time,
weekly under the default schedule. 0020's own Consequences section already recorded half of this:
"Rotation limits which key _future_ writes use; it does not shrink what a past compromise exposes."

Lazy rotation bounds each key to the rows written during its activation window, and costs an insert
to perform. Those two properties are the whole justification. It is not a step toward
crypto-shredding, for the reason the Consequences record.

## Alternatives

| Option                                             | Why not                                                                                                                                                                                                                                                              |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keep the eager sweep on rotation (0020 as written) | The active key covers every row at all times, so rotation bounds nothing; a full re-encryption every week buys audit cadence and no reduction in exposure                                                                                                            |
| Drop data-key rotation entirely                    | Gives up the one cheap response to a leaked data key, and saves nothing — rotation costs an insert and a soft-delete once it is lazy                                                                                                                                 |
| Destroy retired key material once no row names it  | Achieves nothing while the keys live in the database being protected: a key no row names guards no data, and a backup taken while it was in use carries its own copy of the wrapped key, so deleting the live row leaves that backup as readable as before           |
| Re-encrypt a row when it is read                   | Turns reads into writes, with the lock contention and read-replica breakage that implies; `ValueTransformer.from` is synchronous and cannot reach the database; and frequently-read rows would migrate to the newest key, recreating the problem this record removes |
| Remove the sweep altogether                        | Turning encryption on would leave existing rows in plaintext and turning it off would leave them encrypted, so the panel toggle would stop meaning what 0019 decided it means                                                                                        |
| Rotate the KEK instead of the data key             | Addresses 0019's stated threat more directly, but does not exist today and is a larger change; orthogonal to this record rather than a substitute for it                                                                                                             |

## Consequences

**Rotation becomes an insert and a soft-delete.** No rows move, so the scheduled rotation stops
costing a full-table re-encryption and the default interval needs no cost justification.

**A leaked data key now exposes a slice, not everything** — the rows written while it was active.
That slice cannot be shrunk after the fact, only stopped from growing: with no re-encryption action
built, the rows already on the leaked key stay there for as long as nothing rewrites them. Turning
encryption off and on again is the only route available today, and it stores every onboarding as
plain JSON in between, which for a leaked-key incident is not a route at all.

**`progress.pending` changes meaning.** Today it counts rows not on the target key
(`encryption-admin.service.ts:165`); after a lazy rotation that count would never reach zero. It
becomes "rows not yet encrypted" while encryption is on and "rows not yet plain" while it is off.
`isEncryptionChangeInFlight` in the admin panel polls while `pending > 0` and inherits the same
change, or it polls forever.

**The sweep's target narrows.** `resolveTarget` (`encryption-sweep.service.ts:357`) builds a single
target shape whose sources are every resolvable key other than the active one, and so cannot tell
"turn on" from "rotate". Narrowing the sources to empty for the encrypt direction makes a rotation
generate no sweep work, because a rotation creates no plaintext rows; the off direction keeps every
key as a source and still drains completely.

**A superseded key stops being transitional.** It is read-only but live for as long as any row
names it, which may be indefinitely. 0020's grace-window language describes a retirement that no
longer happens on rotation.

**This buys cost and a bounded blast radius, and nothing beyond that.** Crypto-shredding is not
reachable from here and is not what this change is for: it would require the keys to live outside
the database that gets backed up, and to be scoped per erasure subject rather than per time window.
Neither is true of `encryption_keys`, and one key covering every onboarding written in a window
could not serve an erasure request for a single subject in any case. A database dump plus the KEK
still yields the full key history, exactly as 0020 recorded.

**Retaining superseded material stays the right default.** A key no row names costs nothing to
keep, and keeping it means a restored backup or a stale replica still decrypts the rows that name
it.

Reversing this is cheap: widen the sweep's sources back and restore the earlier progress
semantics. No data migration is involved, because every row stays readable under whichever key it
names regardless of which direction the decision runs.
