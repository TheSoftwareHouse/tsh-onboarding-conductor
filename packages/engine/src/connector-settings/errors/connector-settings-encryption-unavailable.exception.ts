import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Refuses to store a secret when no encryption key is configured, rather than writing a provider
 * credential to the database in the clear.
 */
export class ConnectorSettingsEncryptionUnavailableException extends ServiceUnavailableException {
  constructor() {
    super({
      code: 'CONNECTOR_SETTINGS_ENCRYPTION_UNAVAILABLE',
      message: 'CONNECTOR_SETTINGS_ENCRYPTION_UNAVAILABLE',
    });
  }
}
