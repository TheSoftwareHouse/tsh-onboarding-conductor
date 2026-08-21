import { BadRequestException } from '@nestjs/common';

type ConnectorSettingErrors = Readonly<Record<string, readonly string[]>>;

/**
 * Carries which submitted keys were refused, the way `INVALID_STEP_DATA` does, so the panel can
 * mark the offending field instead of showing one message for the whole form.
 */
export class InvalidConnectorSettingsException extends BadRequestException {
  constructor(errors: ConnectorSettingErrors) {
    super({
      code: 'INVALID_CONNECTOR_SETTINGS',
      message: 'INVALID_CONNECTOR_SETTINGS',
      errors,
    });
  }
}
