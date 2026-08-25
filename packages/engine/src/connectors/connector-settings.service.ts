import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ConnectorSettingsRepository } from './connector-settings.repository';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';
import { ConnectorNotConfiguredException } from './errors/connector-not-configured.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

/** The effective settings of one connector, resolved from the stored map alone. */
export interface ResolvedConnectorSettings {
  /** The stored value, or undefined when the key has no stored value. */
  find(key: string): string | undefined;
  /** The stored value, or throws ConnectorNotConfiguredException naming type and key. */
  get(key: string): string;
  /** Every stored value, for a connector whose keys are not declared. */
  entries(): Readonly<Record<string, string>>;
}

/** A connector type's stored map, plus who wrote it and when. */
export type StoredConnectorSettings = Readonly<{
  settings: Readonly<Record<string, string>>;
  updatedAt: Date | null;
  updatedBy: string | null;
}>;

const NO_STORED_SETTINGS: StoredConnectorSettings = {
  settings: {},
  updatedAt: null,
  updatedBy: null,
};

/**
 * Resolves one connector's effective settings from the stored map alone: an
 * unresolvable key either returns `undefined` (`find`) or throws (`get`) per the
 * find/get convention.
 */
class DefaultResolvedConnectorSettings implements ResolvedConnectorSettings {
  constructor(
    private readonly connectorType: string,
    private readonly stored: Readonly<Record<string, string>>,
  ) {}

  find(key: string): string | undefined {
    return this.stored[key];
  }

  get(key: string): string {
    const value = this.find(key);

    if (value === undefined) {
      throw new ConnectorNotConfiguredException(this.connectorType, key);
    }

    return value;
  }

  entries(): Readonly<Record<string, string>> {
    return this.stored;
  }
}

/**
 * The only class that touches the `connector_settings` table. Resolves what an adapter
 * should use at execution time (a stored value, or `ConnectorNotConfiguredException`),
 * and owns the store operations `ConnectorSettingsAdminService` composes for the admin
 * API — `findStored`, `findAllStored`, `replaceStored`, `removeStored`. Depends on the
 * repository and `DataSource` only — never on `CONNECTOR_ADAPTER_COLLECTION` — so an
 * adapter can inject this service directly from its own constructor without closing the
 * registry's dependency cycle (the collection's factory injects every adapter, so a
 * service an adapter depends on must not depend back on the collection).
 *
 * An adapter calls `resolve(this)`: it already holds its own `settingsSchema`, so
 * resolving its settings needs no registry lookup by type. `ConnectorSettingsAdminService`
 * is the one place a type string is turned into an adapter, and the only place that keeps
 * the registry dependency.
 *
 * Confidentiality at rest is the deployment database's responsibility, not this
 * service's — the `settings` column is plain JSON and nothing here encrypts or
 * decrypts it.
 */
@Injectable()
export class ConnectorSettingsService {
  constructor(
    private readonly repository: ConnectorSettingsRepository,
    private readonly dataSource: DataSource,
  ) {}

  async resolve(adapter: ConnectorAdapter): Promise<ResolvedConnectorSettings> {
    const { settings: stored } = await this.findStored(adapter.type);

    return new DefaultResolvedConnectorSettings(adapter.type, stored);
  }

  /** The stored map for a connector type, or the empty default when no row exists. */
  async findStored(connectorType: string): Promise<StoredConnectorSettings> {
    const row = await this.repository.find(this.dataSource.manager, connectorType);
    return this.toStoredConnectorSettings(row);
  }

  /** Every connector type that has a stored row, for the admin list endpoint. */
  async findAllStored(): Promise<ReadonlyMap<string, StoredConnectorSettings>> {
    const rows = await this.repository.findAll(this.dataSource.manager);
    return new Map(rows.map((row) => [row.connectorType, this.toStoredConnectorSettings(row)]));
  }

  /**
   * Replaces the stored map for a connector type wholesale, returning the settings
   * exactly as submitted rather than re-reading them back — the caller has already
   * validated them, and a re-read would only add a redundant query.
   */
  async replaceStored(
    connectorType: string,
    settings: Readonly<Record<string, string>>,
    updatedBy: string | null,
  ): Promise<StoredConnectorSettings> {
    await this.repository.upsert(this.dataSource.manager, connectorType, settings, updatedBy);
    const row = await this.repository.find(this.dataSource.manager, connectorType);

    return { settings, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  /** Drops the stored row, if any, so the key becomes unconfigured again. */
  async removeStored(connectorType: string): Promise<void> {
    await this.repository.delete(this.dataSource.manager, connectorType);
  }

  private toStoredConnectorSettings(row: ConnectorSettingEntity | null): StoredConnectorSettings {
    if (row === null) {
      return NO_STORED_SETTINGS;
    }

    return { settings: row.settings, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
}
