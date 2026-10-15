import { ServiceUnavailableException } from '@nestjs/common';

export class AlgoanUnavailableException extends ServiceUnavailableException {
  static readonly apiDescription =
    'Algoan could not be reached, timed out, or answered with a server error or a body the ' +
    'adapter does not map to an outcome.';

  constructor() {
    super({
      code: 'ALGOAN_UNAVAILABLE',
      message: 'ALGOAN_UNAVAILABLE',
    });
  }
}
