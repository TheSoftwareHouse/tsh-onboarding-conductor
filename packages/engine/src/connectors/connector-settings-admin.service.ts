import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { ConnectorType } from '@tsh/ddl-schema';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import {
  ConnectorSettingsService,
  type StoredConnectorSettings,
} from './connector-settings.service';
import {
  ConnectorSettingsInvalidException,
  type ConnectorSettingsInvalidIssue,
} from './errors/connector-settings-invalid.exception';
import { ConnectorNotFoundException } from './errors/connector-not-found.exception';
import {
  CONNECTOR_ADAPTER_COLLECTION,
  type ConnectorAdapter,
  type ConnectorAdapterCollection,
  type ConnectorSettingDefinition,
  type ConnectorSettingsSchema,
} from './ports/connector-adapter.port';

export type ConnectorSettingSource = 'stored' | 'unset';

export type ConnectorSettingView = Readonly<{
  key: string;
  secret: boolean;
  required: boolean;
  source: ConnectorSettingSource;
  /** Present only when `secret` is false; a secret's value never leaves the service. */
  value?: string;
}>;

export type ConnectorSettingsView = Readonly<{
  /** The connector's own identifier, e.g. `twilio_verify`. */
  id: string;
  /** The class it belongs to, e.g. `messaging` — the axis operators group connectors along. */
  type: ConnectorType;
  name: string;
  /** True when every required key resolves to a value. */
  configured: boolean;
  settings: readonly ConnectorSettingView[];
  updatedAt: Date | null;
  updatedBy: string | null;
}>;

/** A configurable adapter — one whose `settingsSchema` is declared, not `undefined`. */
type ConfigurableConnectorAdapter = ConnectorAdapter & { settingsSchema: ConnectorSettingsSchema };

const isConfigurable = (adapter: ConnectorAdapter): adapter is ConfigurableConnectorAdapter =>
  adapter.settingsSchema !== undefined;

/**
 * The one connector whose schema carries a cross-field rule: `username` and `password`
 * must arrive together or not at all, because `SmtpConnector.createAuthOptions` falls
 * through to an unauthenticated session the moment only one half is present. This stays a
 * single `if` keyed on the connector id rather than a general cross-field rule engine —
 * no other connector needs one.
 */
const SMTP_CONNECTOR_ID = 'smtp';
const SMTP_USERNAME_KEY = 'username';
const SMTP_PASSWORD_KEY = 'password';

/**
 * The admin read/write surface behind `/v1/admin/connectors`: `findSettings`,
 * `listSettings`, `replaceSettings` and `removeSettings`. Unlike
 * `ConnectorSettingsService`, this service depends on `CONNECTOR_ADAPTER_COLLECTION`,
 * because turning a `connectorId` string into its adapter and schema is exactly what
 * the registry is for — and, unlike an adapter, this service is never itself part of
 * the collection the registry's factory builds, so depending on it closes no cycle.
 *
 * Every read or write of a stored credential's value goes through
 * `ConnectorSettingsService`, which is the only class that touches the `connectors` table. It does inject `DataSource` and `AuditService` directly,
 * the same way `ConnectorSettingsService` and `AdminAccessAuditAdapter` do — neither
 * depends on `CONNECTOR_ADAPTER_COLLECTION`, so recording a row here closes no cycle.
 * Only `ConnectorsController` injects this service; no adapter may reach it.
 */
@Injectable()
export class ConnectorSettingsAdminService {
  constructor(
    private readonly connectorSettingsService: ConnectorSettingsService,
    @Inject(CONNECTOR_ADAPTER_COLLECTION)
    private readonly connectors: ConnectorAdapterCollection,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async findSettings(connectorId: string): Promise<ConnectorSettingsView> {
    const adapter = this.getConfigurableAdapter(connectorId);
    const {
      settings: stored,
      updatedAt,
      updatedBy,
    } = await this.connectorSettingsService.findStored(connectorId);

    return this.buildView(adapter, stored, updatedAt, updatedBy);
  }

  async listSettings(): Promise<readonly ConnectorSettingsView[]> {
    const configurableAdapters = this.connectors.filter(isConfigurable);
    const storedById = await this.connectorSettingsService.findAllStored();

    return configurableAdapters.map((adapter) => {
      const stored = storedById.get(adapter.id) ?? {
        settings: {},
        updatedAt: null,
        updatedBy: null,
      };

      return this.buildView(adapter, stored.settings, stored.updatedAt, stored.updatedBy);
    });
  }

  async replaceSettings(
    connectorId: string,
    settings: Readonly<Record<string, unknown>>,
    updatedBy: string | null,
    replace = false,
  ): Promise<ConnectorSettingsView> {
    const adapter = this.getConfigurableAdapter(connectorId);
    const { stored, validated } = await this.writeSettings(adapter, updatedBy, (currentlyStored) =>
      this.validate(adapter, settings, currentlyStored, replace),
    );
    await this.recordSettingsChange(
      'connector_settings.updated',
      connectorId,
      Object.keys(validated),
      updatedBy,
    );

    return this.buildView(adapter, stored.settings, stored.updatedAt, stored.updatedBy);
  }

  /**
   * The `PATCH` counterpart to `replaceSettings`: a submitted string overwrites, a
   * submitted `null` deletes, and a key absent from `changes` survives untouched —
   * which is exactly why an empty `changes` object is refused rather than treated as
   * a no-op audit-worthy write. `validateMerge` checks each submitted key and value
   * against the schema, but a required key and the SMTP pairing against the merged
   * result, per the Proposed Solution's table; `would_be_dropped` never applies here.
   */
  async mergeSettings(
    connectorId: string,
    changes: Readonly<Record<string, string | null>>,
    updatedBy: string | null,
  ): Promise<ConnectorSettingsView> {
    if (Object.keys(changes).length === 0) {
      throw new ConnectorSettingsInvalidException([]);
    }

    const adapter = this.getConfigurableAdapter(connectorId);
    const { stored } = await this.writeSettings(adapter, updatedBy, (currentlyStored) =>
      this.validateMerge(adapter, changes, currentlyStored),
    );
    await this.recordSettingsChange(
      'connector_settings.updated',
      connectorId,
      Object.keys(changes),
      updatedBy,
    );

    return this.buildView(adapter, stored.settings, stored.updatedAt, stored.updatedBy);
  }

  /**
   * Drops the stored row, if any, and always records `connector_settings.deleted` —
   * even when nothing was stored. A `DELETE` on an unconfigured connector is still an
   * operator action worth a trail entry, and checking existence first only to decide
   * whether to log it would add a second read (and a race) for no benefit; the no-op
   * case simply records an empty `keys` list.
   */
  async removeSettings(connectorId: string, actorId: string | null = null): Promise<void> {
    this.getConfigurableAdapter(connectorId);
    const stored = await this.dataSource.transaction(async (manager) => {
      await this.connectorSettingsService.lockSettings(connectorId, manager);
      const { settings } = await this.connectorSettingsService.findStored(connectorId, manager);
      await this.connectorSettingsService.removeStored(connectorId, manager);

      return settings;
    });
    await this.recordSettingsChange(
      'connector_settings.deleted',
      connectorId,
      Object.keys(stored),
      actorId,
    );
  }

  /**
   * The read-modify-write both write paths share, run as one locked transaction so two
   * concurrent requests cannot each merge into the same starting map and have the second
   * erase the first's keys. `buildSettings` receives what is stored right now and returns the
   * map to store, raising `ConnectorSettingsInvalidException` instead when the result would be
   * invalid — which rolls the transaction back and releases the lock without writing.
   *
   * The audit row is deliberately left to the caller, outside this transaction: it records an
   * already-committed settings change, exactly as `AuditService.logConnectorSettingsChange`
   * describes, and must not be able to roll one back.
   */
  private async writeSettings(
    adapter: ConfigurableConnectorAdapter,
    updatedBy: string | null,
    buildSettings: (
      currentlyStored: Readonly<Record<string, string>>,
    ) => Readonly<Record<string, string>>,
  ): Promise<{ stored: StoredConnectorSettings; validated: Readonly<Record<string, string>> }> {
    return this.dataSource.transaction(async (manager) => {
      await this.connectorSettingsService.lockSettings(adapter.id, manager);
      const { settings: currentlyStored } = await this.connectorSettingsService.findStored(
        adapter.id,
        manager,
      );
      const validated = buildSettings(currentlyStored);
      const stored = await this.connectorSettingsService.replaceStored(
        adapter.id,
        adapter.type,
        validated,
        updatedBy,
        manager,
      );

      return { stored, validated };
    });
  }

  /**
   * `keys` names only which settings the write touched — never a value, masked or
   * otherwise, and never the previous value, so a credential can never be
   * reconstructed from the audit trail.
   */
  private async recordSettingsChange(
    action: 'connector_settings.updated' | 'connector_settings.deleted',
    connectorId: string,
    keys: readonly string[],
    actorId: string | null,
  ): Promise<void> {
    await this.auditService.logConnectorSettingsChange(this.dataSource, {
      action,
      actorId: actorId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
      resourceId: connectorId,
      metadata: { connectorId, keys },
    });
  }

  private getConfigurableAdapter(connectorId: string): ConfigurableConnectorAdapter {
    const adapter = this.connectors.find((candidate) => candidate.id === connectorId);

    if (adapter === undefined || !isConfigurable(adapter)) {
      throw new ConnectorNotFoundException();
    }

    return adapter;
  }

  /**
   * Collects every offending key rather than failing on the first one: an undeclared
   * key, a non-string or empty value, a value that fails
   * its field's `pattern`, a required key absent from the submitted map — `PUT` replaces
   * the stored map wholesale, so a required key already stored still has to be
   * resubmitted — and, unless `replace` opts in, a key that is currently stored but
   * missing from the submitted body, which would otherwise be silently dropped by the
   * wholesale replace.
   */
  private validate(
    adapter: ConfigurableConnectorAdapter,
    settings: Readonly<Record<string, unknown>>,
    currentlyStored: Readonly<Record<string, string>>,
    replace: boolean,
  ): Readonly<Record<string, string>> {
    const { settingsSchema: schema, id } = adapter;
    const issues: ConnectorSettingsInvalidIssue[] = [];
    const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field]));
    const validated: Record<string, string> = {};

    for (const [key, value] of Object.entries(settings)) {
      const field = fieldsByKey.get(key);

      if (field === undefined) {
        issues.push({ key, reason: 'undeclared_key' });
        continue;
      }

      const validValue = this.validateValue(field, key, value, issues);

      if (validValue !== undefined) {
        validated[key] = validValue;
      }
    }

    this.checkRequiredKeys(schema, validated, issues);

    if (id === SMTP_CONNECTOR_ID) {
      this.validateSmtpPairing(validated, issues);
    }

    if (!replace) {
      for (const key of Object.keys(currentlyStored)) {
        if (!(key in settings)) {
          issues.push({ key, reason: 'would_be_dropped' });
        }
      }
    }

    if (issues.length > 0) {
      throw new ConnectorSettingsInvalidException(issues);
    }

    return validated;
  }

  /**
   * The merge counterpart of `validate`: each submitted key and value is checked the
   * same way (declared, string, pattern), but `null` deletes rather than
   * failing as `invalid_value`, absent keys are never flagged, and the required-key
   * and SMTP-pairing checks run against the merged map instead of the submitted one —
   * a fragment that looks harmless alone must not leave the connector in a state the
   * wholesale path would have refused.
   */
  private validateMerge(
    adapter: ConfigurableConnectorAdapter,
    changes: Readonly<Record<string, string | null>>,
    currentlyStored: Readonly<Record<string, string>>,
  ): Readonly<Record<string, string>> {
    const { settingsSchema: schema, id } = adapter;
    const issues: ConnectorSettingsInvalidIssue[] = [];
    const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field]));
    const merged: Record<string, string> = { ...currentlyStored };

    for (const [key, value] of Object.entries(changes)) {
      const field = fieldsByKey.get(key);

      if (field === undefined) {
        issues.push({ key, reason: 'undeclared_key' });
        continue;
      }

      if (value === null) {
        delete merged[key];
        continue;
      }

      const validValue = this.validateValue(field, key, value, issues);

      if (validValue !== undefined) {
        merged[key] = validValue;
      }
    }

    this.checkRequiredKeys(schema, merged, issues);

    if (id === SMTP_CONNECTOR_ID) {
      this.validateSmtpPairing(merged, issues);
    }

    if (issues.length > 0) {
      throw new ConnectorSettingsInvalidException(issues);
    }

    return merged;
  }

  /**
   * A submitted value in isolation: must be a non-empty string, and must match its
   * field's `pattern` when one is declared. Shared by `validate` and `validateMerge`
   * — neither path accepts a different notion of "valid" for the value itself, they
   * only differ on what an *absence* or a `null` means.
   */
  private validateValue(
    field: ConnectorSettingDefinition,
    key: string,
    value: unknown,
    issues: ConnectorSettingsInvalidIssue[],
  ): string | undefined {
    if (typeof value !== 'string' || value === '') {
      issues.push({ key, reason: 'invalid_value' });
      return undefined;
    }

    if (field.pattern !== undefined && !field.pattern.test(value)) {
      issues.push({ key, reason: 'invalid_format' });
      return undefined;
    }

    return value;
  }

  /** Every required field must resolve in `record` — the submitted map for `validate`,
   * the merged map for `validateMerge`. */
  private checkRequiredKeys(
    schema: ConnectorSettingsSchema,
    record: Readonly<Record<string, string>>,
    issues: ConnectorSettingsInvalidIssue[],
  ): void {
    for (const field of schema.fields) {
      if (field.required && record[field.key] === undefined) {
        issues.push({ key: field.key, reason: 'missing_required_key' });
      }
    }
  }

  /**
   * `SmtpConnector.createAuthOptions` treats a lone `username` or a lone `password` as
   * "no credentials" and falls through to an unauthenticated SMTP session — a silent
   * downgrade rather than the operator's evident intent. Reject the half-pair at write
   * time instead.
   */
  private validateSmtpPairing(
    validated: Readonly<Record<string, string>>,
    issues: ConnectorSettingsInvalidIssue[],
  ): void {
    const hasUsername = validated[SMTP_USERNAME_KEY] !== undefined;
    const hasPassword = validated[SMTP_PASSWORD_KEY] !== undefined;

    if (hasUsername === hasPassword) {
      return;
    }

    issues.push({
      key: hasUsername ? SMTP_PASSWORD_KEY : SMTP_USERNAME_KEY,
      reason: 'missing_pairing',
    });
  }

  private buildView(
    adapter: ConfigurableConnectorAdapter,
    stored: Readonly<Record<string, string>>,
    updatedAt: Date | null,
    updatedBy: string | null,
  ): ConnectorSettingsView {
    const { settingsSchema: schema } = adapter;
    const settings = schema.fields.map((field) => this.buildSettingView(field, stored));
    const configured = settings
      .filter((setting) => setting.required)
      .every((setting) => setting.source !== 'unset');

    return {
      id: adapter.id,
      type: adapter.type,
      name: adapter.name,
      configured,
      settings,
      updatedAt,
      updatedBy,
    };
  }

  private buildSettingView(
    field: ConnectorSettingDefinition,
    stored: Readonly<Record<string, string>>,
  ): ConnectorSettingView {
    const storedValue = stored[field.key];

    if (storedValue !== undefined) {
      return {
        key: field.key,
        secret: field.secret,
        required: field.required,
        source: 'stored',
        value: field.secret ? undefined : storedValue,
      };
    }

    return {
      key: field.key,
      secret: field.secret,
      required: field.required,
      source: 'unset',
    };
  }
}
