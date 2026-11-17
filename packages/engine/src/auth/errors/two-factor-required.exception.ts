import { ForbiddenException } from '@nestjs/common';

/** The account signs in with a password and has not enrolled TOTP two-factor authentication. */
export class TwoFactorRequiredException extends ForbiddenException {
  static readonly apiDescription =
    'The account signs in with a password and has not enrolled TOTP two-factor authentication.';

  constructor() {
    super({
      code: 'TWO_FACTOR_REQUIRED',
      message: 'Set up two-factor authentication to continue.',
    });
  }
}
