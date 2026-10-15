import { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeWorkflowConnectorSelectionsPerVersion0032 implements MigrationInterface {
  name = '0032_scope_workflow_connector_selections_per_version_2053036800000';

  /** Copies each family-wide row to every published version; a version without the step ignores it. */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflow_connector_selections
        ADD COLUMN version INTEGER NULL,
        DROP CONSTRAINT pk_workflow_connector_selections
    `);

    await queryRunner.query(`
      INSERT INTO workflow_connector_selections
        (workflow_id, version, step_name, connector_id, updated_at, updated_by)
      SELECT s.workflow_id, v.version, s.step_name, s.connector_id, s.updated_at, s.updated_by
      FROM workflow_connector_selections s
      JOIN workflow_versions v
        ON v.workflow_id = s.workflow_id
       AND v.status = 'published'
      WHERE s.version IS NULL
    `);

    await queryRunner.query(`
      DELETE FROM workflow_connector_selections WHERE version IS NULL
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_connector_selections ALTER COLUMN version SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_connector_selections
        ADD CONSTRAINT chk_workflow_connector_selections_version_positive CHECK (version > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_connector_selections
        ADD CONSTRAINT pk_workflow_connector_selections
          PRIMARY KEY (workflow_id, version, step_name)
    `);
  }

  /** Lossy: keeps only the highest version's row per (workflow_id, step_name). */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM workflow_connector_selections s
      USING workflow_connector_selections newer
      WHERE newer.workflow_id = s.workflow_id
        AND newer.step_name = s.step_name
        AND newer.version > s.version
    `);

    await queryRunner.query(`
      ALTER TABLE workflow_connector_selections
        DROP CONSTRAINT pk_workflow_connector_selections,
        DROP CONSTRAINT chk_workflow_connector_selections_version_positive,
        DROP COLUMN version,
        ADD CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, step_name)
    `);
  }
}
