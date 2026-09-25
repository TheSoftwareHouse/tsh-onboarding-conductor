import { ConflictException } from '@nestjs/common';

/**
 * Thrown when an operator tries to rotate the encryption key, or to schedule its rotation, while
 * encryption is turned off: there is no active key to supersede, and none to hang a schedule on.
 * Turning encryption on (`PATCH /v1/admin/encryption`) creates one; both are meaningful only
 * after that.
 */
export class EncryptionDisabledException extends ConflictException {
  static readonly apiDescription =
    'Encryption is turned off, so there is no active key to rotate or to schedule; turn it on ' +
    'first with `PATCH /v1/admin/encryption`.';

  constructor() {
    super({
      code: 'ENCRYPTION_DISABLED',
      message: 'ENCRYPTION_DISABLED',
    });
  }
}
