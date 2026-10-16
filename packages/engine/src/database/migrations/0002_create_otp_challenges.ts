import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOtpChallenges0002 implements MigrationInterface {
  name = '0002_create_otp_challenges_2053382400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE otp_challenges (
        id UUID NOT NULL,
        onboarding_id UUID NOT NULL,
        channel VARCHAR(16) NOT NULL,
        code_hash CHAR(64) NOT NULL,
        code_salt CHAR(32) NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        send_count INTEGER NOT NULL DEFAULT 1,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_otp_challenges PRIMARY KEY (id),
        CONSTRAINT uq_otp_challenges_onboarding_channel UNIQUE (onboarding_id, channel)
      )
    `);
    await queryRunner.query(`
      -- Mirrors OtpChallengeEntity.onboarding
      ALTER TABLE otp_challenges
        ADD CONSTRAINT fk_otp_challenges_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE otp_challenges
        DROP CONSTRAINT IF EXISTS fk_otp_challenges_onboarding
    `);
    await queryRunner.query('DROP TABLE IF EXISTS otp_challenges');
  }
}
