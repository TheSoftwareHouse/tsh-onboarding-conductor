import { ConflictException } from '@nestjs/common';

/**
 * Thrown when two writes to `encryption_keys` race under READ COMMITTED — two operators turning
 * encryption on, rotating, or one of each, at the same instant: the loser's soft-delete of the
 * `deleted_at IS NULL` row matches zero rows because the winner's transaction already committed
 * and claimed it, so the loser's own insert then collides with `uq_encryption_keys_active`. The
 * database invariant held throughout: there is still at most one such row. Surfaced as a named
 * conflict for the operator to retry, rather than an unmapped 500.
 */
export class EncryptionKeyRingConflictException extends ConflictException {
  static readonly apiDescription =
    'Another change to the key ring committed at the same instant; the ring is unaffected — ' +
    'refresh and retry the request.';

  constructor() {
    super({
      code: 'ENCRYPTION_KEY_RING_CONFLICT',
      message: 'ENCRYPTION_KEY_RING_CONFLICT',
    });
  }
}
