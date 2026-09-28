import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOnboardings0002 implements MigrationInterface {
  name = '0002_create_onboardings_1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE onboardings (
        id UUID PRIMARY KEY,
        workflow_version_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_step VARCHAR(100) NULL,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NULL,
        rejection_reason VARCHAR(100) NULL,
        scores JSONB NOT NULL DEFAULT '{}'::jsonb,
        CONSTRAINT chk_onboardings_current_step_nonempty
          CHECK (current_step IS NULL OR btrim(current_step) <> ''),
        CONSTRAINT chk_onboardings_context_object
          CHECK (jsonb_typeof(context) = 'object'),
        CONSTRAINT chk_onboardings_status
          CHECK (status IN ('awaiting_user', 'awaiting_manual_review', 'approved', 'rejected', 'invalid')),
        CONSTRAINT chk_onboardings_lifecycle_state
          CHECK (
            (status IN ('awaiting_user', 'awaiting_manual_review') AND current_step IS NOT NULL AND completed_at IS NULL)
            OR (status IN ('approved', 'rejected', 'invalid') AND current_step IS NULL AND completed_at IS NOT NULL)
          ),
        CONSTRAINT chk_onboardings_rejection_reason_terminal
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
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS onboardings');
  }
}
