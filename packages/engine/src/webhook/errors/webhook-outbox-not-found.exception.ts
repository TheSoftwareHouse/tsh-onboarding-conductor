import { NotFoundException } from '@nestjs/common';

export class WebhookOutboxNotFoundException extends NotFoundException {
  static readonly apiDescription = 'No client webhook outbox entry has this id.';

  constructor() {
    super({
      code: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
      message: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
    });
  }
}
