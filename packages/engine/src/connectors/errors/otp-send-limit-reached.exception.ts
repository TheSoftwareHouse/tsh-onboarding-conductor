import { HttpException, HttpStatus } from '@nestjs/common';

export class OtpSendLimitReachedException extends HttpException {
  static readonly apiDescription =
    'The one-time code has already been sent the maximum number of times for this challenge.';

  constructor() {
    super(
      {
        code: 'OTP_SEND_LIMIT_REACHED',
        message: 'OTP_SEND_LIMIT_REACHED',
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}
