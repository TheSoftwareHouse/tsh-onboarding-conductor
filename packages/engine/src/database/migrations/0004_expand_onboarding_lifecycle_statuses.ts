import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExpandOnboardingLifecycleStatuses0004 implements MigrationInterface {
  name = '0004_expand_onboarding_lifecycle_statuses_1784505600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP CONSTRAINT IF EXISTS chk_onboardings_status,
      DROP CONSTRAINT IF EXISTS chk_onboardings_lifecycle_state
    `);

    await queryRunner.query(`
      ALTER TABLE onboardings
      ADD CONSTRAINT chk_onboardings_status
        CHECK (status IN ('awaiting_user', 'awaiting_manual_review', 'approved', 'rejected')),
      ADD CONSTRAINT chk_onboardings_lifecycle_state
        CHECK (
          (status IN ('awaiting_user', 'awaiting_manual_review') AND current_step IS NOT NULL AND completed_at IS NULL)
          OR (status IN ('approved', 'rejected') AND current_step IS NULL AND completed_at IS NOT NULL)
        )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM onboardings
      WHERE status IN ('awaiting_manual_review', 'rejected')
    `);

    if (count > 0) {
      throw new Error(
        'Cannot rollback migration 0004 because onboardings rows still use awaiting_manual_review or rejected statuses; rollback is blocked to avoid data loss.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP CONSTRAINT IF EXISTS chk_onboardings_status,
      DROP CONSTRAINT IF EXISTS chk_onboardings_lifecycle_state
    `);

    await queryRunner.query(`
      ALTER TABLE onboardings
      ADD CONSTRAINT chk_onboardings_status
        CHECK (status IN ('awaiting_user', 'approved')),
      ADD CONSTRAINT chk_onboardings_lifecycle_state
        CHECK (
          (status = 'awaiting_user' AND current_step IS NOT NULL AND completed_at IS NULL)
          OR (status = 'approved' AND current_step IS NULL AND completed_at IS NOT NULL)
        )
    `);
  }
}
