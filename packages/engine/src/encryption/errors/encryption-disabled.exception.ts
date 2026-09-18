import { ConflictException } from '@nestjs/common';

/**
 * Thrown when an operator tries to rotate the encryption key while `ENCRYPTION_ENABLED=false`.
 * There is no KEK to wrap a new key with and no ring to hold one, so this is refused outright
 * rather than answered with a 500 from whatever check happens to fail first.
 */
export class EncryptionDisabledException extends ConflictException {
  static readonly apiDescription =
    'Encryption is not enabled (`ENCRYPTION_ENABLED=false`), so there is no key to rotate.';

  constructor() {
    super({
      code: 'ENCRYPTION_DISABLED',
      message: 'ENCRYPTION_DISABLED',
    });
  }
}
