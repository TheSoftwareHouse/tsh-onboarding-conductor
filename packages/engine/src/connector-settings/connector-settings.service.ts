import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AppConfig } from '../config/app.config';
import { ConnectorSettingsCipher } from './connector-settings.cipher';
import {
  getConfigurableConnectorTypes,
  getConnectorSettingGroup,
  isConfigurableConnectorType,
  type ConfigurableConnectorType,
  type ConnectorSettingField,
  type ConnectorSettingGroup,
} from './connector-setting-declarations';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import {
  ConnectorSettingFieldResponseDto,
  ConnectorSettingsResponseDto,
  ListConnectorSettingsResponseDto,
} from './dto/connector-settings.response.dto';
import { ConnectorSettingsEncryptionUnavailableException } from './errors/connector-settings-encryption-unavailable.exception';
import { ConnectorSettingsNotConfigurableException } from './errors/connector-settings-not-configurable.exception';
import { InvalidConnectorSettingsException } from './errors/invalid-connector-settings.exception';

/** Long enough for any provider token, short enough that the column is not a payload channel. */
const MAX_SETTING_LENGTH = 4096;

type StoredSettings = Readonly<Record<string, string>>;

/**
 * Serves and edits the connector settings an operator may configure. Reports where each value
 * comes from — the database, the environment, or nowhere — because that is what an operator needs
 * to know before changing one, and never reports a secret's value back.
 */
@Injectable()
export class ConnectorSettingsService {
  constructor(
    @InjectRepository(ConnectorSettingEntity)
    private readonly repository: Repository<ConnectorSettingEntity>,
    private readonly cipher: ConnectorSettingsCipher,
    private readonly configService: ConfigService<AppConfig, true>,
  ) {}

  async list(): Promise<ListConnectorSettingsResponseDto> {
    const connectorTypes = getConfigurableConnectorTypes();
    // One row per configurable connector at most, so the whole table is cheaper to read than to
    // filter down to the types that happen to have one.
    const rows = await this.repository.find();
    const storedByType = new Map(rows.map((row) => [row.connectorType, row.settings]));

    return {
      items: connectorTypes.map((connectorType) =>
        this.mapConnector(connectorType, storedByType.get(connectorType)),
      ),
    };
  }

  /**
   * Applies the submitted keys on top of what is already stored. An empty value removes the
   * stored setting, handing the field back to its environment default, so the panel needs no
   * separate delete route.
   */
  async save(
    connectorType: string,
    values: Record<string, unknown>,
  ): Promise<ConnectorSettingsResponseDto> {
    if (!isConfigurableConnectorType(connectorType)) {
      throw new ConnectorSettingsNotConfigurableException();
    }

    const group = getConnectorSettingGroup(connectorType);

    const submitted = this.readSubmittedValues(group, values);

    const stored = await this.repository.findOne({ where: { connectorType } });
    const settings: Record<string, string> = { ...stored?.settings };

    for (const field of group.fields) {
      const value = submitted[field.key];

      if (value === undefined) {
        continue;
      }

      if (value === '') {
        delete settings[field.key];
        continue;
      }

      settings[field.key] = field.secret ? this.cipher.encrypt(value) : value;
    }

    // An empty map removes the row rather than keeping an empty one, so "nothing is configured
    // here" stays a single state.
    if (Object.keys(settings).length === 0) {
      await this.repository.delete({ connectorType });
    } else {
      await this.repository.upsert({ connectorType, settings }, ['connectorType']);
    }

    return this.mapConnector(connectorType, settings);
  }

  /**
   * Reads the submitted values against what the connector declares, refusing the whole request
   * rather than storing the half of it that made sense.
   */
  private readSubmittedValues(
    group: ConnectorSettingGroup,
    values: Record<string, unknown>,
  ): Record<string, string> {
    const fields = new Map(group.fields.map((field) => [field.key, field]));
    const errors: Record<string, string[]> = {};
    const submitted: Record<string, string> = {};

    for (const [key, value] of Object.entries(values)) {
      const field = fields.get(key);

      if (!field) {
        errors[key] = ['UNKNOWN'];
        continue;
      }

      if (typeof value !== 'string' || value.length > MAX_SETTING_LENGTH) {
        errors[key] = ['INVALID'];
        continue;
      }

      submitted[key] = value.trim();

      // Checked before anything is written, so a form holding several secrets is refused as a
      // whole rather than half-stored.
      if (field.secret && submitted[key] !== '' && !this.cipher.available) {
        throw new ConnectorSettingsEncryptionUnavailableException();
      }
    }

    if (Object.keys(errors).length > 0) {
      throw new InvalidConnectorSettingsException(errors);
    }

    return submitted;
  }

  private mapConnector(
    connectorType: ConfigurableConnectorType,
    settings: StoredSettings | undefined,
  ): ConnectorSettingsResponseDto {
    const group = getConnectorSettingGroup(connectorType);

    return {
      connectorType,
      label: group.label,
      fields: group.fields.map((field) => this.mapField(field, settings?.[field.key])),
    };
  }

  private mapField(
    field: ConnectorSettingField,
    storedValue: string | undefined,
  ): ConnectorSettingFieldResponseDto {
    const declaration = {
      key: field.key,
      label: field.label,
      secret: field.secret,
      required: field.required,
      ...(field.hint === undefined ? {} : { hint: field.hint }),
    };

    // A stored secret is reported as configured and nothing more; only a value the operator could
    // read anywhere else — a sender address, a host — is handed back to the form.
    if (storedValue !== undefined) {
      return { ...declaration, source: 'database', value: field.secret ? null : storedValue };
    }

    const environmentValue = this.configService.get<string>(field.envVar)?.trim();

    if (environmentValue) {
      return {
        ...declaration,
        source: 'environment',
        value: field.secret ? null : environmentValue,
      };
    }

    return { ...declaration, source: 'unset', value: null };
  }
}
