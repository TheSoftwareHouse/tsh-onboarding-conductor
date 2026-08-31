import { InternalServerErrorException } from '@nestjs/common';

export class SumsubUnavailableException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'SUMSUB_UNAVAILABLE',
      message: 'SUMSUB_UNAVAILABLE',
    });
  }
}
