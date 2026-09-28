import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateOnboardingDocuments0003 implements MigrationInterface {
  name = '0003_create_onboarding_documents_1784419200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE onboarding_documents (
        id UUID PRIMARY KEY,
        onboarding_id UUID NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        field_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        staging_object_key VARCHAR(512) NOT NULL,
        final_object_key VARCHAR(512) NULL,
        requested_content_type VARCHAR(255) NOT NULL,
        requested_max_size_bytes BIGINT NOT NULL,
        verified_content_type VARCHAR(255) NULL,
        verified_size_bytes BIGINT NULL,
        verified_etag VARCHAR(255) NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_onboarding_documents_status
          CHECK (status IN ('pending', 'completed', 'expired')),
        CONSTRAINT chk_onboarding_documents_step_name_nonempty
          CHECK (btrim(step_name) <> ''),
        CONSTRAINT chk_onboarding_documents_field_name_nonempty
          CHECK (btrim(field_name) <> ''),
        CONSTRAINT chk_onboarding_documents_requested_max_size_positive
          CHECK (requested_max_size_bytes > 0),
        CONSTRAINT chk_onboarding_documents_verified_size_positive
          CHECK (verified_size_bytes IS NULL OR verified_size_bytes > 0),
        CONSTRAINT chk_onboarding_documents_staging_key_nonempty
          CHECK (btrim(staging_object_key) <> ''),
        CONSTRAINT chk_onboarding_documents_final_key_nonempty
          CHECK (final_object_key IS NULL OR btrim(final_object_key) <> '')
      )
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingDocumentEntity.onboarding
      ALTER TABLE onboarding_documents
        ADD CONSTRAINT fk_onboarding_documents_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      CREATE INDEX idx_onboarding_documents_onboarding_id
        ON onboarding_documents (onboarding_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_staging_object_key
        ON onboarding_documents (staging_object_key)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_final_object_key
        ON onboarding_documents (final_object_key)
        WHERE final_object_key IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_pending_per_onboarding_field
        ON onboarding_documents (onboarding_id, step_name, field_name)
        WHERE status = 'pending'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS onboarding_documents');
  }
}
