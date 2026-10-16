import { InternalServerErrorException } from '@nestjs/common';

export class OtpDeliveryFailedException extends InternalServerErrorException {
  static readonly apiDescription =
    'The one-time code could not be delivered: the SMS provider or the mail transport ' +
    'could not be reached, or answered with an error.';

  constructor() {
    super({
      code: 'OTP_DELIVERY_FAILED',
      message: 'OTP_DELIVERY_FAILED',
    });
  }
}
