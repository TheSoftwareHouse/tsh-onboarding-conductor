import { BadRequestException } from '@nestjs/common';

export class AsyncCallbackAuthenticationFailedException extends BadRequestException {
  static readonly apiDescription =
    'No connector adapter that accepts callbacks is registered under this provider key.';

  constructor() {
    super({
      code: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
      message: 'ASYNC_CALLBACK_AUTHENTICATION_FAILED',
    });
  }
}
