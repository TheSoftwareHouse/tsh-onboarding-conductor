import { Inject, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ADMIN_ACCESS_UNKNOWN_ACTOR } from '../audit/audit.types';
import { AuditService } from '../audit/audit.service';
import { ConnectorSettingsService } from './connector-settings.service';
import {
  ConnectorSettingsInvalidException,
  type ConnectorSettingsInvalidIssue,
} from './errors/connector-settings-invalid.exception';
import { ConnectorTypeNotFoundException } from './errors/connector-type-not-found.exception';
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
  type: string;
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
 * single `if` keyed on the connector type rather than a general cross-field rule engine —
 * no other connector needs one.
 */
const SMTP_CONNECTOR_TYPE = 'smtp';
const SMTP_USERNAME_KEY = 'username';
const SMTP_PASSWORD_KEY = 'password';

/**
 * The admin read/write surface behind `/v1/admin/connectors`: `findSettings`,
 * `listSettings`, `replaceSettings` and `removeSettings`. Unlike
 * `ConnectorSettingsService`, this service depends on `CONNECTOR_ADAPTER_COLLECTION`,
 * because turning a `connectorType` string into its adapter and schema is exactly what
 * the registry is for — and, unlike an adapter, this service is never itself part of
 * the collection the registry's factory builds, so depending on it closes no cycle.
 *
 * Every read or write of a stored credential's value goes through
 * `ConnectorSettingsService`, which is the only class that touches the
 * `connector_settings` table. It does inject `DataSource` and `AuditService` directly,
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

  async findSettings(connectorType: string): Promise<ConnectorSettingsView> {
    const adapter = this.getConfigurableAdapter(connectorType);
    const {
      settings: stored,
      updatedAt,
      updatedBy,
    } = await this.connectorSettingsService.findStored(connectorType);

    return this.buildView(adapter, stored, updatedAt, updatedBy);
  }

  async listSettings(): Promise<readonly ConnectorSettingsView[]> {
    const configurableAdapters = this.connectors.filter(isConfigurable);
    const storedByType = await this.connectorSettingsService.findAllStored();

    return configurableAdapters.map((adapter) => {
      const stored = storedByType.get(adapter.type) ?? {
        settings: {},
        updatedAt: null,
        updatedBy: null,
      };

      return this.buildView(adapter, stored.settings, stored.updatedAt, stored.updatedBy);
    });
  }

  async replaceSettings(
    connectorType: string,
    settings: Readonly<Record<string, unknown>>,
    updatedBy: string | null,
    replace = false,
  ): Promise<ConnectorSettingsView> {
    const adapter = this.getConfigurableAdapter(connectorType);
    const { settings: currentlyStored } =
      await this.connectorSettingsService.findStored(connectorType);
    const validated = this.validate(adapter, settings, currentlyStored, replace);
    const stored = await this.connectorSettingsService.replaceStored(
      connectorType,
      validated,
      updatedBy,
    );
    await this.recordSettingsChange(
      'connector_settings.updated',
      connectorType,
      Object.keys(validated),
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
  async removeSettings(connectorType: string, actorId: string | null = null): Promise<void> {
    this.getConfigurableAdapter(connectorType);
    const { settings: stored } = await this.connectorSettingsService.findStored(connectorType);
    await this.connectorSettingsService.removeStored(connectorType);
    await this.recordSettingsChange(
      'connector_settings.deleted',
      connectorType,
      Object.keys(stored),
      actorId,
    );
  }

  /**
   * `keys` names only which settings the write touched — never a value, masked or
   * otherwise, and never the previous value, so a credential can never be
   * reconstructed from the audit trail.
   */
  private async recordSettingsChange(
    action: 'connector_settings.updated' | 'connector_settings.deleted',
    connectorType: string,
    keys: readonly string[],
    actorId: string | null,
  ): Promise<void> {
    await this.auditService.logConnectorSettingsChange(this.dataSource, {
      action,
      actorId: actorId ?? ADMIN_ACCESS_UNKNOWN_ACTOR,
      resourceId: connectorType,
      metadata: { connectorType, keys },
    });
  }

  private getConfigurableAdapter(connectorType: string): ConfigurableConnectorAdapter {
    const adapter = this.connectors.find((candidate) => candidate.type === connectorType);

    if (adapter === undefined || !isConfigurable(adapter)) {
      throw new ConnectorTypeNotFoundException();
    }

    return adapter;
  }

  /**
   * Collects every offending key rather than failing on the first one: an undeclared
   * key (unless `allowAdditionalKeys`), a non-string or empty value, a value that fails
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
    const { settingsSchema: schema, type } = adapter;
    const issues: ConnectorSettingsInvalidIssue[] = [];
    const fieldsByKey = new Map(schema.fields.map((field) => [field.key, field]));
    const validated: Record<string, string> = {};

    for (const [key, value] of Object.entries(settings)) {
      const field = fieldsByKey.get(key);

      if (field === undefined && schema.allowAdditionalKeys !== true) {
        issues.push({ key, reason: 'undeclared_key' });
        continue;
      }

      if (typeof value !== 'string' || value === '') {
        issues.push({ key, reason: 'invalid_value' });
        continue;
      }

      if (field?.pattern !== undefined && !field.pattern.test(value)) {
        issues.push({ key, reason: 'invalid_format' });
        continue;
      }

      validated[key] = value;
    }

    for (const field of schema.fields) {
      if (field.required && validated[field.key] === undefined) {
        issues.push({ key: field.key, reason: 'missing_required_key' });
      }
    }

    if (type === SMTP_CONNECTOR_TYPE) {
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
    const declaredSettings = schema.fields.map((field) => this.buildSettingView(field, stored));
    const additionalSettings =
      schema.allowAdditionalKeys === true
        ? Object.keys(stored)
            .filter((key) => !schema.fields.some((field) => field.key === key))
            .map((key) => this.buildAdditionalSettingView(key))
        : [];
    const settings = [...declaredSettings, ...additionalSettings];
    const configured = declaredSettings
      .filter((setting) => setting.required)
      .every((setting) => setting.source !== 'unset');

    return {
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

  /** A key beyond `fields`, only reachable when `allowAdditionalKeys` is set — always secret. */
  private buildAdditionalSettingView(key: string): ConnectorSettingView {
    return {
      key,
      secret: true,
      required: false,
      source: 'stored',
    };
  }
}
