import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOnboardings0002 implements MigrationInterface {
  name = 'CreateOnboardings1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE onboardings (
        id UUID PRIMARY KEY,
        workflow_id VARCHAR(100) NOT NULL,
        workflow_version INTEGER NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_step VARCHAR(100) NULL,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_onboardings_workflow_id_nonempty
          CHECK (btrim(workflow_id) <> ''),
        CONSTRAINT chk_onboardings_workflow_version_positive
          CHECK (workflow_version > 0),
        CONSTRAINT chk_onboardings_current_step_nonempty
          CHECK (current_step IS NULL OR btrim(current_step) <> ''),
        CONSTRAINT chk_onboardings_context_object
          CHECK (jsonb_typeof(context) = 'object'),
        CONSTRAINT chk_onboardings_status
          CHECK (status IN ('awaiting_user', 'approved')),
        CONSTRAINT chk_onboardings_lifecycle_state
          CHECK (
            (status = 'awaiting_user' AND current_step IS NOT NULL AND completed_at IS NULL)
            OR (status = 'approved' AND current_step IS NULL AND completed_at IS NOT NULL)
          )
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS onboardings');
  }
}
