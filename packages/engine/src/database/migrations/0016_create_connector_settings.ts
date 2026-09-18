import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectorSettings0016 implements MigrationInterface {
  name = '0016_create_connector_settings_2051568000000';

  /**
   * One row per connector, keyed by the `id` its adapter declares — `twilio_verify`, `smtp` —
   * which is also the value a workflow step's connector declaration names. `type` classifies it
   * along the same axis a workflow's `type` uses, so an operator can ask for every `messaging`
   * connector without knowing which providers implement it.
   *
   * No CHECK constraint on `type`: the allowed set is `CONNECTOR_TYPES` in `@tsh/ddl-schema`,
   * every declaration is validated against it when a workflow loads, and duplicating the list
   * here would make adding a capability a migration.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connectors (
        id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        -- Plain JSON: confidentiality at rest is the deployment database's responsibility
        -- (an encrypted volume or a managed instance's disk encryption), not this table's.
        settings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by VARCHAR(255) NULL,
        CONSTRAINT pk_connectors PRIMARY KEY (id),
        CONSTRAINT chk_connectors_id
          CHECK (id ~ '^[a-z0-9_]+$')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS connectors');
  }
}
