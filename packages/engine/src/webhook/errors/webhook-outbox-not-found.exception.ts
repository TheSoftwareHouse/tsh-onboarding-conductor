import { NotFoundException } from '@nestjs/common';

export class WebhookOutboxNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
      message: 'CLIENT_WEBHOOK_OUTBOX_NOT_FOUND',
    });
  }
}
