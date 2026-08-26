import { NotFoundException } from '@nestjs/common';

/**
 * Answers both an unregistered connector `id` and one that is registered but declares no
 * `settingsSchema` — from a caller's side, neither is a configurable connector.
 */
export class ConnectorNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'CONNECTOR_NOT_FOUND',
      message: 'CONNECTOR_NOT_FOUND',
    });
  }
}
