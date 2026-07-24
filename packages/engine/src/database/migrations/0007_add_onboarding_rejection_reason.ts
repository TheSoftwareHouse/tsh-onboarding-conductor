import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingRejectionReason0007 implements MigrationInterface {
  name = '0007_add_onboarding_rejection_reason_1784851200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      ADD COLUMN rejection_reason VARCHAR(100)
    `);

    await queryRunner.query(`
      ALTER TABLE onboardings
      ADD CONSTRAINT chk_onboardings_rejection_reason_terminal
        CHECK (
          rejection_reason IS NULL
          OR (
            status = 'rejected'
            AND rejection_reason IN (
              'ATTEMPTS_EXHAUSTED',
              'CHALLENGE_EXPIRED',
              'CHALLENGE_NOT_FOUND',
              'CONNECTOR_REJECTED'
            )
          )
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP CONSTRAINT IF EXISTS chk_onboardings_rejection_reason_terminal
    `);

    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP COLUMN IF EXISTS rejection_reason
    `);
  }
}
