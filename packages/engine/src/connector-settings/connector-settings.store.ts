import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import { ConnectorSettingsCipher } from './connector-settings.cipher';
import {
  getConnectorSettingGroup,
  type ConfigurableConnectorType,
  type ConnectorSettingField,
  type ConnectorSettingValues,
} from './connector-setting-declarations';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorSettingsDecryptionError } from './errors/connector-settings-decryption.error';

/**
 * What a connector adapter reads instead of `ConfigService`: the value an operator stored, or the
 * environment default when they stored none.
 *
 * Read on every execution rather than cached, so a credential rotated in the panel takes effect
 * on the next onboarding rather than the next deployment. That is one primary-key lookup next to
 * a network round trip to the provider.
 */
@Injectable()
export class ConnectorSettingsStore {
  constructor(
    @InjectRepository(ConnectorSettingEntity)
    private readonly repository: Repository<ConnectorSettingEntity>,
    private readonly cipher: ConnectorSettingsCipher,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async getValues<TConnectorType extends ConfigurableConnectorType>(
    connectorType: TConnectorType,
  ): Promise<ConnectorSettingValues<TConnectorType>> {
    const stored = await this.repository.findOne({ where: { connectorType } });
    const values: Record<string, string> = {};

    for (const field of getConnectorSettingGroup(connectorType).fields) {
      const value = this.resolveValue(connectorType, field, stored?.settings[field.key]);

      if (value !== undefined) {
        values[field.key] = value;
      }
    }

    return values as ConnectorSettingValues<TConnectorType>;
  }

  private resolveValue(
    connectorType: string,
    field: ConnectorSettingField,
    storedValue: string | undefined,
  ): string | undefined {
    if (typeof storedValue === 'string' && storedValue !== '') {
      try {
        return this.cipher.decrypt(storedValue);
      } catch {
        throw new ConnectorSettingsDecryptionError(connectorType, field.key);
      }
    }

    const environmentValue = this.configService.get<string>(field.envVar);

    return typeof environmentValue === 'string' && environmentValue.trim() !== ''
      ? environmentValue.trim()
      : undefined;
  }
}
