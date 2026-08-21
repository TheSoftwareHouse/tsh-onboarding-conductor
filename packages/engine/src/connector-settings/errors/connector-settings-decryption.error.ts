/**
 * A stored secret cannot be read back: the key is gone, was rotated, or the value was tampered
 * with. Thrown rather than silently falling back to the environment, because a connector running
 * on a credential the operator believes they replaced is the worse failure.
 */
export class ConnectorSettingsDecryptionError extends Error {
  constructor(connectorType: string, settingKey: string) {
    super(
      `Stored setting ${settingKey} of connector type=${connectorType} cannot be decrypted with the configured CONNECTOR_SETTINGS_ENCRYPTION_KEY`,
    );
    this.name = 'ConnectorSettingsDecryptionError';
  }
}
