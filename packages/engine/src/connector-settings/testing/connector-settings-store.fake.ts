import {
  getConnectorSettingGroup,
  type ConfigurableConnectorType,
  type ConnectorSettingValues,
} from '../connector-setting-declarations';
import type { ConnectorSettingsStore } from '../connector-settings.store';

/**
 * A store that resolves every declared field from the given reader, keyed by the field's env var.
 * Connector specs care that a value arrives, not which of the two sources it came from, so they
 * can keep describing their configuration exactly as a deployment does.
 */
export function createConnectorSettingsStoreFake(
  readValue: (envVar: string) => unknown,
): ConnectorSettingsStore {
  const store = {
    async getValues<TConnectorType extends ConfigurableConnectorType>(
      connectorType: TConnectorType,
    ): Promise<ConnectorSettingValues<TConnectorType>> {
      const values: Record<string, string> = {};

      for (const field of getConnectorSettingGroup(connectorType).fields) {
        const value = readValue(field.envVar);

        if (typeof value === 'string' && value !== '') {
          values[field.key] = value;
        }
      }

      return values as ConnectorSettingValues<TConnectorType>;
    },
  };

  return store as unknown as ConnectorSettingsStore;
}
