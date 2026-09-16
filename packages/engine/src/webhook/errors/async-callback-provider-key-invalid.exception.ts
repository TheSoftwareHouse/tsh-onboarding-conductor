import { BadRequestException } from '@nestjs/common';

export class AsyncCallbackProviderKeyInvalidException extends BadRequestException {
  static readonly apiDescription =
    'The provider key is not made of lower-case letters, digits and underscores.';

  constructor() {
    super({
      code: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
      message: 'ASYNC_CALLBACK_PROVIDER_KEY_INVALID',
    });
  }
}
