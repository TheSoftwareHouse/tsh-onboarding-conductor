# 0020. Encryption key ring: a wrapped-key table, an in-envelope key id, timed activation, a bidirectional background sweep, and a schedule carried on the key

- **Status:** Accepted
- **Date:** 2026-09-21
- **Tags:** encryption, security, onboardings, key-rotation, configuration
- **Supersedes:** —
- **Superseded by:** —

## Decision

The key that encrypts `onboardings.context` lives in a table, not in configuration; the panel's
on/off switch, the rotate action and how often the key rotates on its own are all writes to that
table; and one background sweep moves every row toward whatever the table says. Seven choices shape
it, extending 0019.

**1. `ENCRYPTION_KEY` is a key-encryption key (KEK), not a data key.** It never encrypts
`onboardings.context` directly; it wraps each data key stored in `encryption_keys`. A table of
unwrapped keys sitting beside the ciphertext they protect would defeat the feature's whole threat
model — 0019 named that threat as exactly "someone obtained the database" — so the keys that
actually decrypt data are never themselves stored in the clear. The KEK is optional at boot and
required only once the table holds a key: an engine that has keys but no KEK refuses to start
rather than serve unreadable rows.

**2. The envelope carries a key id.** `{ __tsh_enc, k, d }`: naming the key a row was written with
turns "which rows still need moving?" into a predicate over the rows rather than a question only
trial decryption could answer, and lets a row written under any past key be read after any number
of rotations.

**3. Whether encryption is on is derived from the key table.** "On" means a row with
`deleted_at IS NULL` exists. Turning encryption on inserts a key; turning it off soft-deletes the
active one; rotating does both in one transaction. There is no settings row and no flag: the
state cannot disagree with the keys that implement it. Material is retained, never destroyed — a
retired key stays in the table for as long as any row might still name it, and after.

**4. Every change takes effect one refresh interval later, and there is at most one active key
at every instant.** An incoming key's `activated_at` and an outgoing key's `deleted_at` are set to
`now + ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS`, not `now`. A key is active from its
`activated_at` until its `deleted_at`, so on a rotation the two flip together and turning
encryption off leaves none. The partial unique index `uq_encryption_keys_active` makes "at most one
unretired row" the database's invariant rather than application discipline.

**5. The sweep is automatic, background, bidirectional, and its progress is derived, never
stored.** A change to the table is the only trigger; there is no "start" endpoint, no job table and
no counter. Each tick moves a batch of rows not yet in the target state — plaintext rows and rows
on other keys onto the active key while encryption is on, every envelope back to plain JSON while
it is off — through the entity, so the column transformer does the work. It finds that work by
index: equality against the key ids it can read (`idx_onboardings_encryption_key`) plus a partial
index over plaintext rows (`idx_onboardings_plaintext_context`), never an inequality a btree cannot
serve. A row it cannot read is skipped, audited once naming the row, and left for a peer or a
restart; it never blocks the rest. Progress is a count against the target, computed from the rows
that exist — the same discipline ADR 0013 applies to `onboarding_agreement_statuses` — so it stays
honest about a row the sweep cannot finish.

**6. Nothing self-provisions.** A fresh deployment has no key until an operator turns encryption
on from the panel. The engine creates keys only on an operator's request — including the scheduled
rotations of decision 7, which act on a schedule an operator chose — and audits each against
whoever caused it.

**7. The rotation schedule is a column on the key it governs, and the countdown is that key's own
age.** An operator picks how often the engine rotates the key by itself from a closed set — 48
hours, 96 hours, a week, two weeks, a fixed 30-day month — or turns it off, and the choice is
stored as `encryption_keys.rotation_interval` on the single unretired row rather than in a settings
table, for exactly the reason decision 3 gives. The next rotation is that row's `created_at` plus
the interval, so every rotation — the engine's own, or an operator's `POST /keys` — restarts the
countdown simply by creating a row, with no counter to reset; an interval shorter than the active
key's current age therefore falls due at once rather than a fresh interval later. Turning
encryption on schedules `1w`. `EncryptionKeyRotationService` polls every
`ENCRYPTION_KEY_ROTATION_CHECK_INTERVAL_MS` and re-checks due-ness inside the rotation transaction
under an advisory lock, so several replicas cannot each rotate the same due key; what it writes is
the `key_added`/`key_superseded` pair a manual rotation writes, told apart only by `actor_type`
being `system`.

## Context

The first version of 0019 shipped one key in configuration with no rotation and no way to move
stored rows. Rotation was its named follow-up, and rotation had to solve a problem that version
never faced: keeping every process's view of "which keys exist and which is active" correct while
the table changes under it. Once rows could be moved onto a new key, moving them onto _no_ key —
and moving plaintext rows onto the first key — was the same mechanism with a different target,
which is what let the on/off switch move from configuration to the panel.

`ValueTransformer.from()` is called synchronously by TypeORM, not awaited, so the code path that
resolves a stored key id from an envelope must be synchronous too, and a synchronous call cannot
await a database read on a miss. That rules out the obvious design of reloading and retrying inline
when a key id is unknown. It also collides with how this engine actually runs:
`docker-compose.yml` starts `engine` and `engine-worker` as separate processes, so the process that
serves an admin request is never guaranteed to be the process serving the next read.

The key ring is kept fresh by three mechanisms: a periodic reload every
`ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` (default 15s — one indexed query over a table with a
handful of rows), an immediate reload on the process that served the change, and a deduped
background reload triggered by a miss, as the fallback for a process that was down during a
refresh window. Decision 4 is what makes those three sufficient: because no change takes effect
until a full interval after it is made, every process has had a periodic reload in which to learn
of it before any write depends on it. The sweep adds one more margin on its own side — it waits
longer than one interval after first observing a target before moving anything toward it. Each of
these looks removable in isolation; the failure mode if one is removed is a burst of failed reads
on every change, not a compile error.

The sweep's audit trail has the same cross-process problem. More than one process may sweep at
once, so "the sweep started" and "the sweep completed" cannot be decided from one process's memory.
They are decided from the audit log itself, under a transaction-scoped advisory lock keyed on the
event and the key, so two processes racing to record the same step can never both observe "not
yet recorded". Each change of target — a new key, or a switch of direction — is its own episode
with its own `started`/`completed` pair.

## Alternatives

| Option                                                                          | Why not                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store data keys unwrapped in `encryption_keys`                                  | Puts a table of usable keys next to the ciphertext they protect, in the same database — exactly the exposure 0019's threat model exists to defend against                                                                                                                                                   |
| A settings row or flag for "encryption is on", beside the key table             | Two pieces of state that can disagree; "a key row exists that has not been retired" is the fact the flag would have to track, so it is the state                                                                                                                                                            |
| Self-provision the first key at boot behind an environment flag                 | A key created by nobody, encrypting data nobody asked to encrypt; with the switch in the panel, the operator's request is the only sensible trigger, and it is what the audit trail records                                                                                                                 |
| Retry the database read inline inside `keyFor` on a miss                        | `ValueTransformer.from()` is called synchronously by TypeORM; a synchronous function cannot await a query, so an inline retry cannot exist as written                                                                                                                                                       |
| Make a change take effect at once and rely on the periodic refresh alone        | A peer that has not refreshed yet would fail to read a row written under the new key; deferring every change by one interval is what guarantees every peer has refreshed first                                                                                                                              |
| A job or progress table tracking the sweep's state                              | A stored progress counter can go stale independently of the rows it describes; a count over the rows themselves cannot                                                                                                                                                                                      |
| A manual "start sweep" endpoint, separate from changing the table               | Adds an operator step that can be forgotten, leaving rows in the wrong state with nothing to move them; changing the table is already the one action that makes moving them necessary                                                                                                                       |
| Find pending rows with `context ->> 'k' IS DISTINCT FROM <active>`              | Not a condition a btree can serve: measured against a 200k-row table, every idle poll scanned every row and every batch claim walked the whole primary key, growing quadratic as the sweep progressed; equality against the known key ids and a partial index over plaintext rows are both index conditions |
| Fail the whole batch when one row cannot be decrypted                           | The same row heads every batch, so the sweep stalls forever and audits a failure every poll; skipping and auditing that one row keeps the rest moving and keeps the trail readable                                                                                                                          |
| Hard-delete or destroy a retired key's material immediately                     | Rows not yet moved still need it to decrypt; destroying it early would make them permanently unreadable                                                                                                                                                                                                     |
| A settings table or an `ENCRYPTION_ROTATION_INTERVAL` variable for the schedule | The same objection decision 3 answers, plus 0019's: how often data is re-keyed is an operator's decision about the data, not a property of the deployment, and it must be changeable without a redeploy                                                                                                     |
| Restart the countdown from the moment the interval is chosen                    | A second reset rule beside "a new key restarts it", and the weaker one: an operator who shortens the interval because the active key is too old would then have to wait a full fresh interval for the rotation they just asked for                                                                          |
| A cron expression, or a free-form duration, instead of five intervals           | Both the API and the panel would have to validate and render arbitrary schedules, and an operator could ask for a rotation every minute — a full re-encryption sweep of every onboarding each time. The five intervals cover the requirement                                                                |
| Let each replica rotate from its own clock, relying on the unique index         | The loser of that race does not simply no-op: it either fails its insert or supersedes the key the winner just created, so one due key could produce a chain of rotations. Re-checking due-ness inside the lock makes the second replica find nothing to do                                                 |
| A KMS- or Vault-backed KEK                                                      | Removes the last secret from configuration, but is a larger scope than this decision needed; 0019 already named it a follow-up, not a prerequisite                                                                                                                                                          |

## Consequences

**A database dump still yields the full key history.** Because retired key material is retained
rather than destroyed, an attacker who obtains the database — 0019's stated threat — can unwrap
every key that ever protected `onboardings.context`, given the KEK, and therefore decrypt every
row regardless of which key it currently names. Rotation limits which key _future_ writes use; it
does not shrink what a past compromise exposes. Destroying a key's material once no row names it
any longer is the natural next change, not built here.

**Every change is asynchronous, not instantaneous.** `PATCH /v1/admin/encryption` and
`POST /v1/admin/encryption/keys` return as soon as the table is written and the local ring
reloaded; the change takes effect one refresh interval later, and every row still in the previous
state is moved by the sweep on its own schedule, bounded by `ENCRYPTION_SWEEP_BATCH_SIZE` and
`ENCRYPTION_SWEEP_POLL_INTERVAL_MS`. An operator watching the panel sees the new key as pending
activation for a few seconds, then `progress.pending` fall to zero over several polls; every
onboarding stays readable throughout because the reading side resolves whichever key an envelope
actually names, active or not.

**A second change made mid-sweep is safe, not a race to guard against.** Because the sweep's
target is re-derived on every tick, a rotation, a switch off or a switch back on while a sweep is
in progress only changes where rows are heading; rows already moved are picked up again under the
new target exactly as any other lagging row would be, and each target gets its own audit episode.

**A row the sweep cannot read stays pending, visibly.** It is counted in `progress.pending`,
audited once with its id and a value-free reason, and left alone; the operator sees a count that
does not reach zero and a failure row that says why. The usual cause is a KEK that changed since
the row's key was wrapped, which a restart with the right KEK fixes.

**The freshness mechanism is the part most likely to be "simplified" into a bug later.** Removing
the deferred activation, the periodic timer, the sweep's start delay, or the on-miss fallback each
look independently prunable; each is the answer to a specific failure mode documented in Context
above.

**Ciphertext still binds to its column, not to its row**, carried over unchanged from 0019: the
additional authenticated data remains the column label, so a value moved into a different column
fails to decrypt, while a value moved between rows of the same column does not.

**Shortening the interval below the active key's age rotates immediately**, with the full
re-encryption sweep that follows. That is what "rotate every 48 hours" asks for when the key is
three days old, and the panel says so — in the copy under the control before the change, and again
after it, when the state comes back reporting a rotation already due.

**Nothing starts rotating on an upgrade.** `rotation_interval` is nullable and migration `0026`
backfills nothing, so a deployment that already had encryption on keeps rotating only on request
until an operator chooses a schedule; only turning encryption on from here on schedules `1w`.

**A deployment of `MODE=api-only` processes alone never rotates on its schedule**, exactly as it
never sweeps: both are background work gated on a process that holds the KEK and is not api-only.
The schedule is still stored and still reported, so the omission shows up as a `nextRotationAt` in
the past rather than as silence.

**Reversing this decision is cheap for the data and permanent for the history.** Turning
encryption off returns every row to plain JSON through the same sweep; the retained rows of
`encryption_keys` remain as the record of what protected the data and when, and nothing collapses
that history back to zero after the fact.
