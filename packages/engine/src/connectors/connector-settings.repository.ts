import { EntityManager } from 'typeorm';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';

/**
 * Moves the settings JSON for a connector type in and out of Postgres. Confidentiality
 * at rest is the deployment database's responsibility, not this repository's — it holds
 * no crypto knowledge and moves the map as plain JSON.
 */
export class ConnectorSettingsRepository {
  /** The stored row for a connector type, or `null` when none has been written yet. */
  async find(
    manager: EntityManager,
    connectorType: string,
  ): Promise<ConnectorSettingEntity | null> {
    return manager.getRepository(ConnectorSettingEntity).findOne({ where: { connectorType } });
  }

  /** Every stored connector's settings row, for the admin list endpoint. */
  async findAll(manager: EntityManager): Promise<ConnectorSettingEntity[]> {
    return manager.getRepository(ConnectorSettingEntity).find();
  }

  /**
   * Replaces the settings map for a connector type wholesale: inserts it on the first
   * write, overwrites it on every later one. There is no partial update — the caller
   * always supplies the full map for the type.
   */
  async upsert(
    manager: EntityManager,
    connectorType: string,
    settings: Readonly<Record<string, string>>,
    updatedBy: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO connector_settings (connector_type, settings, updated_at, updated_by)
       VALUES ($1, $2::jsonb, now(), $3)
       ON CONFLICT ON CONSTRAINT pk_connector_settings DO UPDATE
         SET settings = EXCLUDED.settings,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by`,
      [connectorType, JSON.stringify(settings), updatedBy],
    );
  }

  /** Drops the stored row, if any. Deleting a connector type with no row is a no-op. */
  async delete(manager: EntityManager, connectorType: string): Promise<void> {
    await manager.getRepository(ConnectorSettingEntity).delete({ connectorType });
  }
}
