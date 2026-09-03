import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingScore0019 implements MigrationInterface {
  name = '0019_add_onboarding_score_2051827200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
        ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0,
        ADD COLUMN IF NOT EXISTS score_by_step JSONB NOT NULL DEFAULT '{}'::jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE onboardings DROP COLUMN IF EXISTS score_by_step');
    await queryRunner.query('ALTER TABLE onboardings DROP COLUMN IF EXISTS score');
  }
}
