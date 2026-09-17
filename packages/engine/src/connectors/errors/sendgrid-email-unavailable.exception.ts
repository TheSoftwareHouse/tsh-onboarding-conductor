import { InternalServerErrorException } from '@nestjs/common';

export class SendgridEmailUnavailableException extends InternalServerErrorException {
  static readonly apiDescription =
    'SendGrid could not be reached, or answered with an error the adapter does not map to ' +
    'an outcome.';

  constructor() {
    super({
      code: 'SENDGRID_EMAIL_UNAVAILABLE',
      message: 'SENDGRID_EMAIL_UNAVAILABLE',
    });
  }
}
