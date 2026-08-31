import { MigrationInterface, QueryRunner } from 'typeorm';

export class RenameConnectorSettingsToConnectors0017 implements MigrationInterface {
  name = '0017_rename_connector_settings_to_connectors_2051654400000';

  /**
   * `connector_settings` held one column of settings keyed by `connector_type`; the row is really
   * the connector, so it becomes `connectors` with `id` and a `type` naming what the connector
   * does — the capability an operator groups connectors by.
   *
   * The backfill hardcodes the id-to-capability mapping as it stands at this migration. That is
   * deliberate and is what a migration is for: `type` is declared by adapter code, which is free
   * to change afterwards, and a migration must not depend on a constant that later moves. Rows are
   * re-stamped from the adapter on the next settings write regardless. `custom` is the fallback for
   * an id this snapshot does not know, which is the same value a connector with no capability of
   * its own carries.
   *
   * No CHECK constraint on `type`: the allowed set is `CONNECTOR_TYPES` in `@tsh/ddl-schema`, every
   * declaration is validated against it when a workflow loads, and duplicating the list here would
   * make adding a capability a migration.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE connector_settings RENAME TO connectors');
    await queryRunner.query('ALTER TABLE connectors RENAME COLUMN connector_type TO id');
    await queryRunner.query(
      'ALTER TABLE connectors RENAME CONSTRAINT pk_connector_settings TO pk_connectors',
    );
    await queryRunner.query(
      'ALTER TABLE connectors RENAME CONSTRAINT chk_connector_settings_connector_type TO chk_connectors_id',
    );

    await queryRunner.query('ALTER TABLE connectors ADD COLUMN IF NOT EXISTS type VARCHAR(32)');
    await queryRunner.query(`
      UPDATE connectors
      SET type = CASE id
        WHEN 'mock_kyc_1' THEN 'kyc'
        WHEN 'mock_kyc_2' THEN 'kyc'
        WHEN 'mock_sumsub_file_upload' THEN 'kyc'
        WHEN 'twilio_verify' THEN 'phone_verification'
        WHEN 'mock_phone_verification' THEN 'phone_verification'
        WHEN 'mock_email_verification' THEN 'email_verification'
        WHEN 'sendgrid_email' THEN 'email_delivery'
        WHEN 'smtp' THEN 'email_delivery'
        WHEN 'mock_email_delivery' THEN 'email_delivery'
        ELSE 'custom'
      END
      WHERE type IS NULL
    `);
    await queryRunner.query('ALTER TABLE connectors ALTER COLUMN type SET NOT NULL');
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE connectors DROP COLUMN IF EXISTS type');
    await queryRunner.query(
      'ALTER TABLE connectors RENAME CONSTRAINT chk_connectors_id TO chk_connector_settings_connector_type',
    );
    await queryRunner.query(
      'ALTER TABLE connectors RENAME CONSTRAINT pk_connectors TO pk_connector_settings',
    );
    await queryRunner.query('ALTER TABLE connectors RENAME COLUMN id TO connector_type');
    await queryRunner.query('ALTER TABLE connectors RENAME TO connector_settings');
  }
}
