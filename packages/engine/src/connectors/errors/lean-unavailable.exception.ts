import { InternalServerErrorException } from '@nestjs/common';

export class LeanUnavailableException extends InternalServerErrorException {
  static readonly apiDescription =
    'Lean could not be reached, or answered with a server error or a credential failure the ' +
    'adapter does not map to an outcome.';

  constructor() {
    super({
      code: 'LEAN_UNAVAILABLE',
      message: 'LEAN_UNAVAILABLE',
    });
  }
}
