import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgreements0022 implements MigrationInterface {
  name = '0022_create_agreements_2052172800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agreements (
        id UUID NOT NULL,
        key VARCHAR(100) NOT NULL,
        type VARCHAR(64) NOT NULL,
        version INTEGER NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_agreements PRIMARY KEY (id),
        CONSTRAINT uq_agreements_key_version UNIQUE (key, version),
        CONSTRAINT ck_agreements_version_positive CHECK (version > 0),
        CONSTRAINT ck_agreements_key_not_empty CHECK (btrim(key) <> '')
      )
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS onboarding_agreements (
        onboarding_id UUID NOT NULL,
        agreement_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_onboarding_agreements PRIMARY KEY (onboarding_id, agreement_id),
        CONSTRAINT ck_onboarding_agreements_status CHECK (status IN ('pending', 'accepted')),
        CONSTRAINT ck_onboarding_agreements_accepted_at
          CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
      )
    `);
    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.onboarding
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);
    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.agreement
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_agreement
        FOREIGN KEY (agreement_id) REFERENCES agreements (id) ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_onboarding_agreements_agreement
        ON onboarding_agreements (agreement_id)
    `);
    await queryRunner.query(`
      CREATE VIEW onboarding_agreement_statuses AS
      WITH latest AS (
        SELECT key, MAX(version) AS version FROM agreements GROUP BY key
      ), per_key AS (
        SELECT oa.onboarding_id, a.key,
               MAX(CASE WHEN oa.status = 'accepted' THEN a.version END) AS accepted_version
          FROM onboarding_agreements oa
          JOIN agreements a ON a.id = oa.agreement_id
         GROUP BY oa.onboarding_id, a.key
      )
      SELECT pk.onboarding_id,
             CASE WHEN bool_or(pk.accepted_version IS NULL)      THEN 'not_accepted'
                  WHEN bool_or(pk.accepted_version < l.version)  THEN 'outdated'
                  ELSE 'current' END AS agreement_status
        FROM per_key pk JOIN latest l ON l.key = pk.key
       GROUP BY pk.onboarding_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP VIEW IF EXISTS onboarding_agreement_statuses');
    await queryRunner.query('DROP TABLE IF EXISTS onboarding_agreements');
    await queryRunner.query('DROP TABLE IF EXISTS agreements');
  }
}
