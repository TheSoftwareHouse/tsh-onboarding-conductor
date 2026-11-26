import { UnauthorizedException } from '@nestjs/common';

/** There is no valid admin session; sign in again. */
export class AdminSessionRequiredException extends UnauthorizedException {
  static readonly apiDescription = 'There is no valid admin session; sign in again.';

  constructor() {
    super({
      code: 'ADMIN_SESSION_REQUIRED',
      message: 'Sign in to continue.',
    });
  }
}
