import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflows0013 implements MigrationInterface {
  name = '0013_create_workflows_2051308800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflows (
        workflow_id UUID NOT NULL,
        -- The document's id: what the HTTP contract calls workflowId. Not a display label.
        key VARCHAR(100) NOT NULL,
        -- The display label of the highest stored version declaring a root name; null until one does.
        name VARCHAR(200),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflows PRIMARY KEY (workflow_id),
        CONSTRAINT uq_workflows_key UNIQUE (key),
        CONSTRAINT chk_workflows_key_nonempty
          CHECK (btrim(key) <> ''),
        CONSTRAINT chk_workflows_name_nonempty
          CHECK (name IS NULL OR btrim(name) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS workflow_versions (
        workflow_version_id UUID NOT NULL,
        workflow_id UUID NOT NULL,
        version INTEGER NOT NULL,
        scope VARCHAR(32) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'published',
        -- JSON, not JSONB: jsonb normalizes objects and reorders their keys,
        -- and a workflow's field order is the order clients render fields in.
        definition JSON NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflow_versions PRIMARY KEY (workflow_version_id),
        CONSTRAINT uq_workflow_versions_workflow_version UNIQUE (workflow_id, version),
        CONSTRAINT chk_workflow_versions_version_positive
          CHECK (version > 0),
        CONSTRAINT chk_workflow_versions_scope
          CHECK (scope IN ('built-in', 'fixtures', 'users')),
        CONSTRAINT chk_workflow_versions_definition_object
          CHECK (json_typeof(definition) = 'object'),
        CONSTRAINT chk_workflow_versions_status
          CHECK (status IN ('draft', 'published', 'retired'))
      )
    `);

    await queryRunner.query(`
      -- Mirrors WorkflowVersionEntity.workflow
      ALTER TABLE workflow_versions
        ADD CONSTRAINT fk_workflow_versions_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingEntity.workflowVersion
      ALTER TABLE onboardings
        ADD CONSTRAINT fk_onboardings_workflow_version
        FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions (workflow_version_id) ON DELETE RESTRICT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboardings
      DROP CONSTRAINT IF EXISTS fk_onboardings_workflow_version
    `);
    await queryRunner.query(`
      ALTER TABLE workflow_versions
      DROP CONSTRAINT IF EXISTS fk_workflow_versions_workflow
    `);
    await queryRunner.query('DROP TABLE IF EXISTS workflow_versions');
    await queryRunner.query('DROP TABLE IF EXISTS workflows');
  }
}
