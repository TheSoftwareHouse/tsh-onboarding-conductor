import { EntityManager } from 'typeorm';
import type { ConnectorType } from '@tsh/ddl-schema';
import { ConnectorEntity } from './entity/connector.entity';

/**
 * Moves a connector's settings JSON in and out of Postgres. Confidentiality at rest is the
 * deployment database's responsibility, not this repository's — it holds no crypto knowledge
 * and moves the map as plain JSON.
 */
export class ConnectorsRepository {
  /**
   * Serializes every read-modify-write on one connector's settings for the rest of the calling
   * transaction. A row lock is not enough: the first write to a connector has no row to lock, so
   * two concurrent first writes would each merge into an empty map and the second would erase the
   * first's keys. An advisory lock keyed on the id covers that case too, and Postgres releases it
   * on commit or rollback without anything here having to remember to.
   */
  async lock(manager: EntityManager, id: string): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
  }

  /** The stored row for a connector id, or `null` when none has been written yet. */
  async find(manager: EntityManager, id: string): Promise<ConnectorEntity | null> {
    return manager.getRepository(ConnectorEntity).findOne({ where: { id } });
  }

  /** Every stored connector row, for the admin list endpoint. */
  async findAll(manager: EntityManager): Promise<ConnectorEntity[]> {
    return manager.getRepository(ConnectorEntity).find();
  }

  /**
   * Replaces the settings map for a connector wholesale: inserts it on the first write,
   * overwrites it on every later one. There is no partial update — the caller always supplies
   * the full map. `type` is re-stamped from the adapter on every write, so a row's class cannot
   * drift from the adapter that owns it for longer than one settings change.
   */
  async upsert(
    manager: EntityManager,
    id: string,
    type: ConnectorType,
    settings: Readonly<Record<string, string>>,
    updatedBy: string | null,
  ): Promise<void> {
    await manager.query(
      `INSERT INTO connectors (id, type, settings, updated_at, updated_by)
       VALUES ($1, $2, $3::jsonb, now(), $4)
       ON CONFLICT ON CONSTRAINT pk_connectors DO UPDATE
         SET type = EXCLUDED.type,
             settings = EXCLUDED.settings,
             updated_at = now(),
             updated_by = EXCLUDED.updated_by`,
      [id, type, JSON.stringify(settings), updatedBy],
    );
  }

  /** Drops the stored row, if any. Deleting a connector with no row is a no-op. */
  async delete(manager: EntityManager, id: string): Promise<void> {
    await manager.getRepository(ConnectorEntity).delete({ id });
  }
}
