import type { EncryptionKeyEntity } from './entity/encryption-key.entity';

/** The two timestamps a rotation decision needs off a row; a full entity satisfies this too. */
type ActivationFields = Pick<EncryptionKeyEntity, 'activatedAt' | 'deletedAt'>;

/**
 * Whether `row` is the key `encrypt` must use at `now`. A key becomes active once its
 * `activatedAt` has arrived and stops being active once its `deletedAt` has arrived — never
 * merely because `deletedAt` is *set*, since `EncryptionAdminService.addKey` gives the outgoing
 * key a **future** `deletedAt` (equal to the incoming key's `activatedAt`) rather than the moment
 * of rotation. That grace window is what keeps exactly one key active at every instant while
 * still guaranteeing every replica has had a full `ENCRYPTION_KEY_RING_REFRESH_INTERVAL_MS` to
 * learn the incoming key exists before anything encrypts with it — see the class doc comment on
 * `EncryptionAdminService`.
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

/** The id of the single row {@link isKeyActive} admits at `now`, or `null` if none does. */
export function resolveActiveKeyId(
  rows: readonly (ActivationFields & { id: string })[],
  now: Date,
): string | null {
  return rows.find((row) => isKeyActive(row, now))?.id ?? null;
}
