import { ConflictException } from '@nestjs/common';

/**
 * Thrown when an operator tries to rotate the encryption key while encryption is turned off:
 * there is no active key to supersede. Turning encryption on (`PATCH /v1/admin/encryption`)
 * creates one; rotating is meaningful only after that.
 */
export class EncryptionDisabledException extends ConflictException {
  static readonly apiDescription =
    'Encryption is turned off, so there is no active key to rotate; turn it on first with ' +
    '`PATCH /v1/admin/encryption`.';

  constructor() {
    super({
      code: 'ENCRYPTION_DISABLED',
      message: 'ENCRYPTION_DISABLED',
    });
  }
}
