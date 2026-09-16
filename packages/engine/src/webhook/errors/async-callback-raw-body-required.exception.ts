import { BadRequestException } from '@nestjs/common';

export class AsyncCallbackRawBodyRequiredException extends BadRequestException {
  static readonly apiDescription =
    'The callback arrived without a body the signature could be verified over.';

  constructor() {
    super({
      code: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
      message: 'ASYNC_CALLBACK_RAW_BODY_REQUIRED',
    });
  }
}
