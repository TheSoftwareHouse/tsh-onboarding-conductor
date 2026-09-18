import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgreements0022 implements MigrationInterface {
  name = '0022_create_agreements_2052172800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id UUID NOT NULL,
        workflow_id UUID,
        key VARCHAR(100) NOT NULL,
        type VARCHAR(64) NOT NULL,
        current_version_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_agreements PRIMARY KEY (id),
        CONSTRAINT uq_agreements_key UNIQUE (key),
        CONSTRAINT ck_agreements_key_not_empty CHECK (btrim(key) <> '')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agreement_versions (
        agreement_version_id UUID NOT NULL,
        agreement_id UUID NOT NULL,
        version INTEGER NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_agreement_versions PRIMARY KEY (agreement_version_id),
        CONSTRAINT uq_agreement_versions_agreement_version UNIQUE (agreement_id, version),
        CONSTRAINT ck_agreement_versions_version_positive CHECK (version > 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS onboarding_agreements (
        onboarding_id UUID NOT NULL,
        agreement_version_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_onboarding_agreements PRIMARY KEY (onboarding_id, agreement_version_id),
        CONSTRAINT ck_onboarding_agreements_status CHECK (status IN ('pending', 'accepted')),
        CONSTRAINT ck_onboarding_agreements_accepted_at
          CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      -- Mirrors AgreementEntity.workflow
      ALTER TABLE agreements
        ADD CONSTRAINT fk_agreements_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      -- Mirrors AgreementEntity.currentVersion
      ALTER TABLE agreements
        ADD CONSTRAINT fk_agreements_current_version
        FOREIGN KEY (current_version_id) REFERENCES agreement_versions (agreement_version_id) ON DELETE SET NULL
    `);
    await queryRunner.query(`
      -- Mirrors AgreementVersionEntity.agreement
      ALTER TABLE agreement_versions
        ADD CONSTRAINT fk_agreement_versions_agreement
        FOREIGN KEY (agreement_id) REFERENCES agreements (id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.onboarding
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.agreementVersion
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_agreement_version
        FOREIGN KEY (agreement_version_id) REFERENCES agreement_versions (agreement_version_id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_onboarding_agreements_agreement_version
        ON onboarding_agreements (agreement_version_id)
    `);
    await queryRunner.query(`
      CREATE VIEW onboarding_agreement_statuses AS
      WITH latest AS (
        SELECT agreement_id, MAX(version) AS version FROM agreement_versions GROUP BY agreement_id
      ), per_agreement AS (
        SELECT oa.onboarding_id, av.agreement_id,
               MAX(CASE WHEN oa.status = 'accepted' THEN av.version END) AS accepted_version
          FROM onboarding_agreements oa
          JOIN agreement_versions av ON av.agreement_version_id = oa.agreement_version_id
         GROUP BY oa.onboarding_id, av.agreement_id
      )
      SELECT pa.onboarding_id,
             CASE WHEN bool_or(pa.accepted_version IS NULL)     THEN 'not_accepted'
                  WHEN bool_or(pa.accepted_version < l.version) THEN 'outdated'
                  ELSE 'current' END AS agreement_status
        FROM per_agreement pa JOIN latest l ON l.agreement_id = pa.agreement_id
       GROUP BY pa.onboarding_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP VIEW IF EXISTS onboarding_agreement_statuses');
    await queryRunner.query(`
      ALTER TABLE onboarding_agreements
        DROP CONSTRAINT IF EXISTS fk_onboarding_agreements_agreement_version
    `);
    await queryRunner.query(`
      ALTER TABLE onboarding_agreements
        DROP CONSTRAINT IF EXISTS fk_onboarding_agreements_onboarding
    `);
    await queryRunner.query(`
      ALTER TABLE agreement_versions
        DROP CONSTRAINT IF EXISTS fk_agreement_versions_agreement
    `);
    await queryRunner.query(`
      ALTER TABLE agreements
        DROP CONSTRAINT IF EXISTS fk_agreements_current_version
    `);
    await queryRunner.query(`
      ALTER TABLE agreements
        DROP CONSTRAINT IF EXISTS fk_agreements_workflow
    `);
    await queryRunner.query('DROP TABLE IF EXISTS onboarding_agreements');
    await queryRunner.query('DROP TABLE IF EXISTS agreement_versions');
    await queryRunner.query('DROP TABLE IF EXISTS agreements');
  }
}
