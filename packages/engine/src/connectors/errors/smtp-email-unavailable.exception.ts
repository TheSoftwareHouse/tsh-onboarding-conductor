import { InternalServerErrorException } from '@nestjs/common';

export class SmtpEmailUnavailableException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'SMTP_EMAIL_UNAVAILABLE',
      message: 'SMTP_EMAIL_UNAVAILABLE',
    });
  }
}
