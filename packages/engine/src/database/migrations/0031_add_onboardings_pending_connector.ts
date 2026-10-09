import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingsPendingConnector0031 implements MigrationInterface {
  name = '0031_add_onboardings_pending_connector_2052950400000';

  /**
   * The connector an onboarding is parked on while it awaits an asynchronous callback —
   * `{connectorId, connectorName, connectorOrder, providerReference?}`. Plain JSONB, never
   * encrypted: the callback resolver reads it without the encryption port. `NULL` while the
   * onboarding is not parked (and on rows parked before this column existed).
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
        ADD COLUMN pending_connector JSONB NULL,
        ADD CONSTRAINT chk_onboardings_pending_connector_object
          CHECK (pending_connector IS NULL OR jsonb_typeof(pending_connector) = 'object')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
        DROP CONSTRAINT IF EXISTS chk_onboardings_pending_connector_object,
        DROP COLUMN IF EXISTS pending_connector
    `);
  }
}
