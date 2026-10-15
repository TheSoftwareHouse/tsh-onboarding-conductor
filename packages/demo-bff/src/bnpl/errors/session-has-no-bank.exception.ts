import { ConflictException } from '@nestjs/common';

/** A bank login was attempted while the onboarding is not at the bank-connection step. */
export class SessionHasNoBankException extends ConflictException {
  constructor() {
    super({ code: 'SESSION_HAS_NO_BANK', message: 'SESSION_HAS_NO_BANK' });
  }
}
