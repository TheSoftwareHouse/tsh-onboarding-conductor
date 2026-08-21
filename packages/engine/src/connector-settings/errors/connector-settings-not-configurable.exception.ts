import { NotFoundException } from '@nestjs/common';

export class ConnectorSettingsNotConfigurableException extends NotFoundException {
  constructor() {
    super({
      code: 'CONNECTOR_SETTINGS_NOT_CONFIGURABLE',
      message: 'CONNECTOR_SETTINGS_NOT_CONFIGURABLE',
    });
  }
}
