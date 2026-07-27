import { InternalServerErrorException } from '@nestjs/common';

export class WebhookDeliveryFailedException extends InternalServerErrorException {
  constructor() {
    super({
      code: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
      message: 'CLIENT_WEBHOOK_DELIVERY_FAILED',
    });
  }
}
