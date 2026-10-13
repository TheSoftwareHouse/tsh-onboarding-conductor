import { InternalServerErrorException } from '@nestjs/common';

export class VeriffUnavailableException extends InternalServerErrorException {
  static readonly apiDescription =
    'Veriff could not be reached, or answered with an error the adapter does not map to ' +
    'an outcome.';

  constructor() {
    super({
      code: 'VERIFF_UNAVAILABLE',
      message: 'VERIFF_UNAVAILABLE',
    });
  }
}
