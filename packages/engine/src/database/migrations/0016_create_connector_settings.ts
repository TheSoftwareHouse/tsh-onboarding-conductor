import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectorSettings0016 implements MigrationInterface {
  name = '0016_create_connector_settings_2051568000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connector_settings (
        connector_type VARCHAR(64) NOT NULL,
        -- Plain JSON: confidentiality at rest is the deployment database's responsibility
        -- (an encrypted volume or a managed instance's disk encryption), not this table's.
        settings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by VARCHAR(255) NULL,
        CONSTRAINT pk_connector_settings PRIMARY KEY (connector_type),
        CONSTRAINT chk_connector_settings_connector_type
          CHECK (connector_type ~ '^[a-z0-9_]+$')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS connector_settings');
  }
}
