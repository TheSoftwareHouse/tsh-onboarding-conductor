import { ConflictException } from '@nestjs/common';

/**
 * Thrown when two concurrent `POST /v1/admin/encryption/keys` requests race under READ
 * COMMITTED: the loser's soft-delete of the active row matches zero rows — the winner's
 * transaction already committed and claimed it — so the loser's own insert then collides with
 * `uq_encryption_keys_active`. The database invariant held throughout: there is still exactly one
 * active key, never zero or two. This is surfaced as a named conflict for the operator to retry,
 * rather than an unmapped 500.
 */
export class EncryptionKeyRotationConflictException extends ConflictException {
  static readonly apiDescription =
    'Another rotation committed at the same instant; the key ring is unaffected — retry the ' +
    'request.';

  constructor() {
    super({
      code: 'ENCRYPTION_KEY_ROTATION_CONFLICT',
      message: 'ENCRYPTION_KEY_ROTATION_CONFLICT',
    });
  }
}
