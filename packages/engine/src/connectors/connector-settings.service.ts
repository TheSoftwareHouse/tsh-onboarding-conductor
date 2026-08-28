import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import type { ConnectorType } from '@tsh/ddl-schema';
import { ConnectorsRepository } from './connectors.repository';
import { ConnectorEntity } from './entity/connector.entity';
import { ConnectorNotConfiguredException } from './errors/connector-not-configured.exception';
import type { ConnectorAdapter } from './ports/connector-adapter.port';

/** The effective settings of one connector, resolved from the stored map alone. */
export interface ResolvedConnectorSettings {
  /** The stored value, or undefined when the key has no stored value. */
  find(key: string): string | undefined;
  /** The stored value, or throws ConnectorNotConfiguredException naming the connector and key. */
  get(key: string): string;
}

/** A connector's stored map, plus who wrote it and when. */
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
    private readonly connectorId: string,
    private readonly stored: Readonly<Record<string, string>>,
  ) {}

  find(key: string): string | undefined {
    return this.stored[key];
  }

  get(key: string): string {
    const value = this.find(key);

    if (value === undefined) {
      throw new ConnectorNotConfiguredException(this.connectorId, key);
    }

    return value;
  }
}

/**
 * The only class that touches the `connectors` table. Resolves what an adapter
 * should use at execution time (a stored value, or `ConnectorNotConfiguredException`),
 * and owns the store operations `ConnectorSettingsAdminService` composes for the admin
 * API — `findStored`, `findAllStored`, `replaceStored`, `removeStored`. Depends on the
 * repository and `DataSource` only — never on `CONNECTOR_ADAPTER_COLLECTION` — so an
 * adapter can inject this service directly from its own constructor without closing the
 * registry's dependency cycle (the collection's factory injects every adapter, so a
 * service an adapter depends on must not depend back on the collection).
 *
 * An adapter calls `resolve(this)`: it already holds its own `settingsSchema`, so
 * resolving its settings needs no registry lookup by id. `ConnectorSettingsAdminService`
 * is the one place an id string is turned into an adapter, and the only place that keeps
 * the registry dependency.
 *
 * Confidentiality at rest is the deployment database's responsibility, not this
 * service's — the `settings` column is plain JSON and nothing here encrypts or
 * decrypts it.
 */
@Injectable()
export class ConnectorSettingsService {
  constructor(
    private readonly repository: ConnectorsRepository,
    private readonly dataSource: DataSource,
  ) {}

  async resolve(adapter: ConnectorAdapter): Promise<ResolvedConnectorSettings> {
    const { settings: stored } = await this.findStored(adapter.id);

    return new DefaultResolvedConnectorSettings(adapter.id, stored);
  }

  /**
   * Takes out the write lock for one connector, so a read-modify-write of its settings is not
   * interleaved with another request's. Must be called inside `manager`'s transaction — the lock
   * lives until that transaction ends. See `ConnectorsRepository.lock`.
   */
  async lockSettings(connectorId: string, manager: EntityManager): Promise<void> {
    await this.repository.lock(manager, connectorId);
  }

  /**
   * The stored map for a connector, or the empty default when no row exists. Pass `manager` to
   * read inside a caller's transaction; without it the read uses the default connection.
   */
  async findStored(
    connectorId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StoredConnectorSettings> {
    const row = await this.repository.find(manager, connectorId);
    return this.toStoredConnectorSettings(row);
  }

  /** Every connector that has a stored row, keyed by id, for the admin list endpoint. */
  async findAllStored(): Promise<ReadonlyMap<string, StoredConnectorSettings>> {
    const rows = await this.repository.findAll(this.dataSource.manager);
    return new Map(rows.map((row) => [row.id, this.toStoredConnectorSettings(row)]));
  }

  /**
   * Replaces the stored map for a connector wholesale, returning the settings exactly as
   * submitted rather than re-reading them back — the caller has already validated them, and a
   * re-read would only add a redundant query. `type` is taken from the adapter rather than from
   * the caller's intent, so a stored row always carries the class its adapter declares.
   */
  async replaceStored(
    connectorId: string,
    type: ConnectorType,
    settings: Readonly<Record<string, string>>,
    updatedBy: string | null,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<StoredConnectorSettings> {
    await this.repository.upsert(manager, connectorId, type, settings, updatedBy);
    const row = await this.repository.find(manager, connectorId);

    return { settings, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
  }

  /** Drops the stored row, if any, so the key becomes unconfigured again. */
  async removeStored(
    connectorId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<void> {
    await this.repository.delete(manager, connectorId);
  }

  private toStoredConnectorSettings(row: ConnectorEntity | null): StoredConnectorSettings {
    if (row === null) {
      return NO_STORED_SETTINGS;
    }

    return { settings: row.settings, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  }
}
