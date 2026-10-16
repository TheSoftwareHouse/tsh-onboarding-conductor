import { BadRequestException } from '@nestjs/common';

export class AsyncCallbackPayloadInvalidException extends BadRequestException {
  static readonly apiDescription =
    "The callback verified but the adapter could not read it as its provider's payload: not " +
    'JSON, not an object, or missing the identifiers that correlate it to an onboarding. It ' +
    'can never apply, so it is not retried; the drop is in the audit trail.';

  constructor() {
    super({
      code: 'CALLBACK_PAYLOAD_INVALID',
      message: 'CALLBACK_PAYLOAD_INVALID',
    });
  }
}
