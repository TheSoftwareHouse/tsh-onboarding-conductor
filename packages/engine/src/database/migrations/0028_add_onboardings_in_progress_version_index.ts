import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingsInProgressVersionIndex0028 implements MigrationInterface {
  name = '0028_add_onboardings_in_progress_version_index_2052691200000';

  /** Serves the admin workflows list's in-progress count; partial, so it holds only unfinished onboardings (ADR 0032). */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_onboardings_in_progress_version
        ON onboardings (workflow_version_id)
        WHERE completed_at IS NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_onboardings_in_progress_version');
  }
}
