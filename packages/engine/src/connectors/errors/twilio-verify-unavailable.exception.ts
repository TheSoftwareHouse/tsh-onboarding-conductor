import { InternalServerErrorException } from '@nestjs/common';

export class TwilioVerifyUnavailableException extends InternalServerErrorException {
  static readonly apiDescription =
    'Twilio Verify could not be reached, or answered with an error the adapter does not ' +
    'map to an outcome.';

  constructor() {
    super({
      code: 'TWILIO_VERIFY_UNAVAILABLE',
      message: 'TWILIO_VERIFY_UNAVAILABLE',
    });
  }
}
