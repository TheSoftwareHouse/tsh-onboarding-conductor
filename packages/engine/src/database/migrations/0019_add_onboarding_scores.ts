import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingScores0019 implements MigrationInterface {
  name = '0019_add_onboarding_scores_2051827200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      ADD COLUMN scores JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP COLUMN IF EXISTS scores
    `);
  }
}
