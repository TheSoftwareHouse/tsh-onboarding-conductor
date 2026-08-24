import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import type { AdminOperatorIdentity } from '../auth/admin-access-audit.port';
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
    private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
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
    operator: AdminOperatorIdentity | null,
  ): Promise<ConnectorSettingsResponseDto> {
    if (!isConfigurableConnectorType(connectorType)) {
      throw new ConnectorSettingsNotConfigurableException();
    }

    const group = getConnectorSettingGroup(connectorType);
    const submitted = this.readSubmittedValues(group, values);

    const storedValues: Record<string, string> = {};
    const clearedKeys: string[] = [];

    for (const field of group.fields) {
      const value = submitted.get(field.key);

      if (value === undefined) {
        continue;
      }

      if (value === '') {
        clearedKeys.push(field.key);
        continue;
      }

      storedValues[field.key] = field.secret ? this.cipher.encrypt(value) : value;
    }

    if (Object.keys(storedValues).length === 0 && clearedKeys.length === 0) {
      const stored = await this.repository.findOne({ where: { connectorType } });

      return this.mapConnector(connectorType, stored?.settings);
    }

    // The settings and the record of who changed them commit together: a trail that disagreed
    // with the credential the engine is about to use would be worse than no trail.
    const settings = await this.dataSource.transaction(async (manager) => {
      const applied = await this.applyChange(manager, connectorType, storedValues, clearedKeys);

      await this.auditService.logConnectorSettingsChange(manager, {
        actorType: operator === null ? 'anonymous' : 'operator',
        actorId: operator?.objectId ?? '',
        resourceId: connectorType,
        metadata: { storedKeys: Object.keys(storedValues), clearedKeys },
      });

      return applied;
    });

    return this.mapConnector(connectorType, settings);
  }

  /**
   * Merges the change into the stored settings in one statement, so two operators editing
   * different fields of the same connector cannot overwrite one another: whoever commits second
   * merges onto what the first wrote rather than onto what they read before it existed.
   *
   * A row left with no settings is removed rather than kept empty, so "nothing is configured
   * here" stays a single state.
   */
  private async applyChange(
    manager: EntityManager,
    connectorType: string,
    storedValues: Record<string, string>,
    clearedKeys: readonly string[],
  ): Promise<StoredSettings> {
    const table = this.repository.metadata.tableName;
    const rows = (await manager.query(
      `INSERT INTO ${table} (connector_type, settings)
       VALUES ($1, $2::jsonb)
       ON CONFLICT (connector_type) DO UPDATE
          SET settings = (${table}.settings || excluded.settings) - $3::text[],
              updated_at = now()
       RETURNING settings`,
      [connectorType, JSON.stringify(storedValues), clearedKeys],
    )) as Array<{ settings: Record<string, string> }>;

    const settings = rows[0]?.settings ?? {};

    if (Object.keys(settings).length === 0) {
      await manager.delete(ConnectorSettingEntity, { connectorType });

      return {};
    }

    return settings;
  }

  /**
   * Reads the submitted values against what the connector declares, refusing the whole request
   * rather than storing the half of it that made sense.
   */
  private readSubmittedValues(
    group: ConnectorSettingGroup,
    values: Record<string, unknown>,
  ): Map<string, string> {
    const fields = new Map(group.fields.map((field) => [field.key, field]));
    // Maps rather than object literals: a submitted key of `__proto__` assigns to an object's
    // prototype instead of becoming an own property, which would leave the refusal invisible to
    // the `size` check below and answer 200 for a request that was never applied.
    const errors = new Map<string, readonly string[]>();
    const submitted = new Map<string, string>();

    for (const [key, value] of Object.entries(values)) {
      const field = fields.get(key);

      if (!field) {
        errors.set(key, ['UNKNOWN']);
        continue;
      }

      if (typeof value !== 'string' || value.length > MAX_SETTING_LENGTH) {
        errors.set(key, ['INVALID']);
        continue;
      }

      const trimmed = value.trim();
      submitted.set(key, trimmed);

      // Checked before anything is written, so a form holding several secrets is refused as a
      // whole rather than half-stored.
      if (field.secret && trimmed !== '' && !this.cipher.available) {
        throw new ConnectorSettingsEncryptionUnavailableException();
      }
    }

    if (errors.size > 0) {
      throw new InvalidConnectorSettingsException(Object.fromEntries(errors));
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
