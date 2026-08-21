import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectorSettings0016 implements MigrationInterface {
  name = '0016_create_connector_settings_2051568000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connector_settings (
        connector_type varchar(100) NOT NULL,
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT pk_connector_settings PRIMARY KEY (connector_type)
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS connector_settings`);
  }
}
