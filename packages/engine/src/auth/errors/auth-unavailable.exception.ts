import { ServiceUnavailableException } from '@nestjs/common';

/** The auth store could not be reached, so the session was never judged. Retry. */
export class AuthUnavailableException extends ServiceUnavailableException {
  static readonly apiDescription =
    'The auth store could not be reached, so the session was never judged. Retry.';

  constructor() {
    super({
      code: 'AUTH_UNAVAILABLE',
      message: 'Authentication is unavailable right now. Try again shortly.',
    });
  }
}
