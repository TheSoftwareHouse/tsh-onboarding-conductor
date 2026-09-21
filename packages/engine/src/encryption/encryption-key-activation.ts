import type { EncryptionKeyEntity } from './entity/encryption-key.entity';

/** The two timestamps a rotation decision needs off a row; a full entity satisfies this too. */
type ActivationFields = Pick<EncryptionKeyEntity, 'activatedAt' | 'deletedAt'>;

/**
 * Whether `row` is the key `encrypt` must use at `now`. A key becomes active once its
 * `activatedAt` has arrived and stops being active once its `deletedAt` has arrived — never
 * merely because `deletedAt` is *set*, since `EncryptionAdminService` gives an outgoing key a
 * **future** `deletedAt` (equal to the incoming key's `activatedAt` on a rotation, or `now` plus
 * one refresh interval when encryption is turned off) rather than the moment of the change. That
 * grace window is what keeps at most one key active at every instant while still guaranteeing
 * every replica has had a full `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` to learn of the change
 * before any write depends on it — see the class doc comment on `EncryptionAdminService`.
 */
export function isKeyActive(row: ActivationFields, now: Date): boolean {
  return (
    row.activatedAt.getTime() <= now.getTime() &&
    (row.deletedAt === null || row.deletedAt.getTime() > now.getTime())
  );
}

/**
 * Whether `row` is the incoming key of a rotation still in its grace window: not deleted, but not
 * active yet either, because its `activatedAt` has not arrived. Distinct from `isKeyActive` being
 * `false`, which is also true of every superseded, historical key — this is `true` only for the
 * single row waiting to take over.
 */
export function isKeyPendingActivation(row: ActivationFields, now: Date): boolean {
  return row.deletedAt === null && row.activatedAt.getTime() > now.getTime();
}

/**
 * The id of the single row {@link isKeyActive} admits at `now`, or `null` if none does — which
 * is the steady state while encryption is off, not an error.
 */
export function resolveActiveKeyId(
  rows: readonly (ActivationFields & { id: string })[],
  now: Date,
): string | null {
  return rows.find((row) => isKeyActive(row, now))?.id ?? null;
}

/**
 * The id of the key whose `deletedAt` most recently arrived by `now`, or `null` if no key has
 * ever been retired. While encryption is off this names the key the sweep is moving rows off,
 * which is the resource its `decryption_*` audit rows are filed against; a key whose `deletedAt`
 * is still in the future is still active and does not qualify.
 */
export function resolveLatestDeactivatedKeyId(
  rows: readonly (ActivationFields & { id: string })[],
  now: Date,
): string | null {
  let latest: (ActivationFields & { id: string; deletedAt: Date }) | null = null;

  for (const row of rows) {
    if (row.deletedAt === null || row.deletedAt.getTime() > now.getTime()) {
      continue;
    }

    if (latest === null || row.deletedAt.getTime() > latest.deletedAt.getTime()) {
      latest = { ...row, deletedAt: row.deletedAt };
    }
  }

  return latest?.id ?? null;
}
