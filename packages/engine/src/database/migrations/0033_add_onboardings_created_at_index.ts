import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingsCreatedAtIndex0033 implements MigrationInterface {
  name = '0033_add_onboardings_created_at_index_2053296000000';

  /** Serves the admin list's order and the CSV export's keyset batches (ADR 0044). */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_onboardings_created_at_id
        ON onboardings (created_at DESC, id DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_onboardings_created_at_id');
  }
}
