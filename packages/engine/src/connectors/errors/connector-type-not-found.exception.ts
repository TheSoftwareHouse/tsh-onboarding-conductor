import { NotFoundException } from '@nestjs/common';

/**
 * Answers both an unregistered `connector_type` and one that is registered but declares
 * no `settingsSchema` — from a caller's side, neither is a configurable connector.
 */
export class ConnectorTypeNotFoundException extends NotFoundException {
  constructor() {
    super({
      code: 'CONNECTOR_TYPE_NOT_FOUND',
      message: 'CONNECTOR_TYPE_NOT_FOUND',
    });
  }
}
