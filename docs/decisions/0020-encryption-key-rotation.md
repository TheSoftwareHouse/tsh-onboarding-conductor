# 0020. Encryption key rotation: a wrapped-key table, an in-envelope key id, and an automatic background sweep

- **Status:** Proposed
- **Date:** 2026-09-17
- **Tags:** encryption, security, onboardings, key-rotation, configuration
- **Supersedes:** —
- **Superseded by:** —

## Decision

The engine can rotate the key that encrypts `onboardings.context` from the admin panel, and moves
every row onto the new key by itself, in the background, with full key history retained. Six
choices shape it, extending 0019 rather than replacing it.

**1. `ENCRYPTION_KEY` becomes a key-encryption key (KEK), not a data key.** It no longer encrypts
`onboardings.context` directly; it wraps each data key stored in a new `encryption_keys` table. A
table of unwrapped keys sitting beside the ciphertext they protect would defeat the feature's whole
threat model — 0019 named that threat as exactly "someone obtained the database" — so the keys that
actually decrypt data are never themselves stored in the clear.

**2. The envelope gains a key id.** `{ __tsh_enc, k, d }` replaces 0019's `{ __tsh_enc, d }`.
Naming the key a row was written with turns "which rows still need re-encrypting?" into a plain
predicate — rows whose envelope names something other than the active key — rather than a question
only trial decryption could answer. That predicate is what makes the re-encryption sweep idempotent
and resumable by construction: a crash resumes where it left off, a second rotation started
mid-sweep simply moves the target, and a row written during a sweep already carries the active key
and is never selected.

**3. Adding a key soft-deletes the previous one; material is retained, never destroyed.**
`deleted_at` is set on the superseded row, but its wrapped key stays in the table for as long as
any onboarding might still name it — and after. A database dump therefore still yields every key
that ever protected data: rotation limits future exposure, not past exposure, and that is a stated
trade rather than an oversight. Destroying a key's material once no row names it any longer is a
deliberate follow-up, not built here.

**4. Re-encryption is automatic, background, and its progress is derived, never stored.** Adding a
key is the only trigger; there is no manual "start re-encryption" endpoint, no job or progress
table, and no counter column. Progress is a count of `onboardings.context` rows whose envelope
names a non-active key — the same discipline ADR 0013 applies to `onboarding_agreement_statuses`:
computed from the rows that already exist, so it cannot go stale independently of them.

**5. First boot self-provisions a key.** With `ENCRYPTION_ENABLED=true` and an empty
`encryption_keys` table, the engine generates, wraps and stores its first key itself. Turning the
flag on therefore still works with nothing but `.env`, exactly as before this change — the table
stays an implementation detail until an operator chooses to rotate. This is the engine acting on
its own initiative, which is why it is audited (`encryption.initial_key_created`), not merely
logged.

**6. Exactly one active key is a database invariant.** A partial unique index
(`uq_encryption_keys_active`, on `(deleted_at IS NULL) WHERE deleted_at IS NULL`) refuses a second
row with `deleted_at IS NULL` outright. Soft-deleting the previous key and inserting the new one
happen in one transaction, so the database — not application discipline — guarantees there is
never a moment with zero or two active keys.

## Context

0019 shipped one key with no rotation, by design — "one key, AES-256-GCM, and no rotation in this
version" — and named key rotation explicitly as a candidate follow-up. This change is that
follow-up, and it has to solve a problem 0019 never faced: keeping every process's view of "which
keys exist and which is active" correct while rotation happens.

`ValueTransformer.from()` is called synchronously by TypeORM, not awaited, so the code path that
resolves a stored key id from an envelope must be synchronous too, and a synchronous call cannot
await a database read on a miss. That rules out the obvious design of reloading and retrying inline
when a key id is unknown. It also collides with how this engine actually runs:
`docker-compose.yml` starts `engine` and `engine-worker` as separate processes, so the process that
serves a `POST` rotation is never guaranteed to be the process serving the next read — after a
rotation, a read on the other process would otherwise hit a ring that has not yet learned the new
key.

The key ring is instead kept fresh by three mechanisms, in the order that does the work: a periodic
reload every `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` (default 15s — one indexed query over a
table with a handful of rows) so a key added anywhere is known everywhere within one interval; an
immediate reload on the process that served the rotation, so that process is correct instantly; and
a fire-and-forget, deduped reload triggered by a miss, as the fallback for a process that was down
or starting during a refresh window. The re-encryption sweep closes the remaining gap on its own
side: it waits longer than one refresh interval after first observing a new active key before
re-encrypting that key's first batch, so no row is written naming a key id other processes have not
yet had the chance to learn — which is what keeps the on-miss fallback a rare case rather than
something every rotation depends on. This is the least obvious part of the design and the one most
likely to look removable in a later simplification; the failure mode if it is removed is a burst of
failed reads on every rotation, not a compile error.

## Alternatives

| Option                                                              | Why not                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store data keys unwrapped in `encryption_keys`                      | Puts a table of usable keys next to the ciphertext they protect, in the same database — exactly the exposure 0019's threat model exists to defend against                                                                                          |
| Retry the database read inline inside `keyFor` on a miss            | `ValueTransformer.from()` is called synchronously by TypeORM; a synchronous function cannot await a query, so an inline retry cannot exist as written                                                                                              |
| Rely on the periodic ring refresh alone, with no sweep start delay  | `engine` and `engine-worker` are separate processes; without the sweep's own delay, it could write a row naming a key a reading process has not polled for yet, turning every rotation into a burst of failed reads instead of an exceptional case |
| A job or progress table tracking re-encryption state                | Ruled out by the plan explicitly, in the spirit of ADR 0013: a stored progress counter can go stale independently of the rows it describes; deriving it from the envelope predicate cannot                                                         |
| A manual "start re-encryption" endpoint, separate from adding a key | Adds an operator step that can be forgotten, leaving rows on an old key with nothing to trigger a move; adding a key is already the one action that makes re-encryption necessary                                                                  |
| Hard-delete or destroy a superseded key's material immediately      | In-flight re-encryption still needs the old key to decrypt rows not yet moved; destroying it early would make those rows permanently unreadable                                                                                                    |
| A KMS- or Vault-backed KEK                                          | Removes the last secret from configuration, but is a larger scope than rotation itself needed; 0019 already named it a rotation-adjacent follow-up, not a rotation prerequisite                                                                    |

## Consequences

**A database dump still yields the full key history.** Because superseded key material is retained
rather than destroyed, an attacker who obtains the database — 0019's stated threat — can unwrap
every key that ever protected `onboardings.context`, given the KEK, and therefore decrypt every row
regardless of which key it currently names. Rotation limits which key _future_ writes use; it does
not shrink what a past compromise exposes. Destroying a key's material once no row names it any
longer would close that gap and is the natural next change, not built here.

**Rotation is asynchronous, not instantaneous.** `POST /v1/admin/encryption/keys` returns as soon
as the new key is stored and the local ring reloaded; every row still on the old key is moved by
the background sweep on its own schedule, bounded by `ENCRYPTION_REENCRYPTION_BATCH_SIZE` and
`ENCRYPTION_REENCRYPTION_POLL_INTERVAL_MS`, not by the request. An operator watching
`GET /v1/admin/encryption/keys` sees `reEncryption.pending` fall to zero over several poll cycles
rather than immediately, and every onboarding stays readable throughout because the decrypting side
resolves whichever key an envelope actually names, active or not.

**A second rotation started mid-sweep is safe, not a race to guard against.** Because the sweep's
target is a predicate re-evaluated on every tick, adding another key while a sweep is in progress
only changes what "non-active" means; rows already moved onto the key before it are picked up again
under the new predicate exactly as any other lagging row would be.

**The ring's freshness mechanism is the part most likely to be "simplified" into a bug later.**
Removing the periodic timer, the sweep's start delay, or the on-miss fallback each look
independently prunable in isolation; each is the answer to a specific failure mode — a rotating
process's peers never learning the new key at all, the sweep outrunning what other processes have
polled, or a process down during a refresh window — documented in Context above.

**Ciphertext still binds to its column, not to its row**, carried over unchanged from 0019: the
additional authenticated data remains the column label, so a value moved into a different column
fails to decrypt, while a value moved between rows of the same column does not. This decision does
not change that boundary.

**Reversing key rotation itself is not cheap.** Undoing it back to a single, unrotatable key would
mean picking one key, re-encrypting every row onto it through the same sweep mechanism, and then
deciding what to do with `encryption_keys`' retained history — there is no code path that collapses
that history back to zero after the fact.
