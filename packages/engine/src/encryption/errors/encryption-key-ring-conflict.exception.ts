import { ConflictException } from '@nestjs/common';

/**
 * Thrown when two rotations race under READ COMMITTED: both read the same active row, the winner's
 * transaction commits first, and the loser's insert then collides with `uq_encryption_keys_active`
 * — the winner's new row already holds `deleted_at IS NULL`. The database invariant held
 * throughout: there is still at most one such row. Surfaced as a named conflict for the operator
 * to refresh and retry, rather than an unmapped 500. Only rotation raises it: two operators
 * turning encryption *on* at the same instant both want the state the winner produced, so the
 * loser of that race is answered with the resulting state, as an idempotent repeat would be.
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
