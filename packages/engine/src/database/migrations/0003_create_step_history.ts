import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateStepHistory0003 implements MigrationInterface {
  name = '0003_create_step_history_1735689600001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE step_history (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        onboarding_id UUID NOT NULL,
        applied_step VARCHAR(100) NOT NULL,
        outcome VARCHAR(32) NOT NULL,
        resulting_status VARCHAR(32) NOT NULL,
        resulting_current_step VARCHAR(100) NULL,
        field_errors JSONB NULL,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_step_history_outcome
          CHECK (outcome IN ('validation_rejected', 'transitioned')),
        CONSTRAINT chk_step_history_resulting_status
          CHECK (resulting_status IN ('awaiting_user', 'approved')),
        CONSTRAINT chk_step_history_current_step_nonempty
          CHECK (resulting_current_step IS NULL OR btrim(resulting_current_step) <> ''),
        CONSTRAINT fk_step_history_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES onboardings(id) ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_step_history_onboarding_id_recorded_at
      ON step_history (onboarding_id, recorded_at)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS step_history');
  }
}
