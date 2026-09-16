import { InternalServerErrorException } from '@nestjs/common';

export class SumsubUnavailableException extends InternalServerErrorException {
  static readonly apiDescription =
    'Sumsub could not be reached, or answered with an error the adapter does not map to ' +
    'an outcome.';

  constructor() {
    super({
      code: 'SUMSUB_UNAVAILABLE',
      message: 'SUMSUB_UNAVAILABLE',
    });
  }
}
