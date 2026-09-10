import { InternalServerErrorException } from '@nestjs/common';

export class WebhookDeliveryFailedException extends InternalServerErrorException {
  static readonly apiDescription =
    'The client webhook for this move could not be delivered; the outbox entry was ' +
    'returned to pending for the worker to retry.';

  constructor() {
    super({
      code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
    });
  }
}
