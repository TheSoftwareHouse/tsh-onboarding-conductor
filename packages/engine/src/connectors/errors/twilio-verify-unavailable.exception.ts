import { InternalServerErrorException } from '@nestjs/common';

export class TwilioVerifyUnavailableException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'TWILIO_VERIFY_UNAVAILABLE',
      message: 'TWILIO_VERIFY_UNAVAILABLE',
    });
  }
}
