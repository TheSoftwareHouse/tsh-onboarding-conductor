import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflows0013 implements MigrationInterface {
  name = '0013_create_workflows_2051308800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        workflow_id VARCHAR(100) NOT NULL,
        version INTEGER NOT NULL,
        scope VARCHAR(32) NOT NULL,
        -- JSON, not JSONB: jsonb normalizes objects and reorders their keys,
        -- and a workflow's field order is the order clients render fields in.
        definition JSON NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflows PRIMARY KEY (workflow_id, version),
        CONSTRAINT chk_workflows_version_positive
          CHECK (version > 0),
        CONSTRAINT chk_workflows_scope
          CHECK (scope IN ('built-in', 'fixtures', 'users')),
        CONSTRAINT chk_workflows_definition_object
          CHECK (json_typeof(definition) = 'object')
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS workflows');
  }
}
