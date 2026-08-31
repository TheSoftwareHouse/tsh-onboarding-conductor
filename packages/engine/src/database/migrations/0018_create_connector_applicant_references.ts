import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateConnectorApplicantReferences0018 implements MigrationInterface {
  name = '0018_create_connector_applicant_references_2051740800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS connector_applicant_references (
        onboarding_id UUID NOT NULL,
        connector_id VARCHAR(64) NOT NULL,
        applicant_id VARCHAR(64) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_connector_applicant_references PRIMARY KEY (onboarding_id, connector_id)
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_connector_applicant_references_connector_applicant
        ON connector_applicant_references (connector_id, applicant_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS connector_applicant_references');
  }
}
