import { InternalServerErrorException } from '@nestjs/common';

export class SendgridEmailUnavailableException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'SENDGRID_EMAIL_UNAVAILABLE',
      message: 'SENDGRID_EMAIL_UNAVAILABLE',
    });
  }
}
