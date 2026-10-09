import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkflowConnectorSelections0030 implements MigrationInterface {
  name = '0030_create_workflow_connector_selections_2052864000000';

  /**
   * One row per (workflow family, step): the connector id an operator bound to that step at
   * runtime, replacing the primary connector's `id` in every stored version that has the step.
   * `step_name` is not a foreign key — it names a step inside the versions' JSON documents.
   * `connector_id` carries the same shape check as `connectors.id`; whether an adapter with that
   * id exists is a runtime question, answered by the registered adapters.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE workflow_connector_selections (
        workflow_id UUID NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        connector_id VARCHAR(64) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by VARCHAR(255) NULL,
        CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, step_name),
        CONSTRAINT chk_workflow_connector_selections_step_name_nonempty
          CHECK (btrim(step_name) <> ''),
        CONSTRAINT chk_workflow_connector_selections_connector_id
          CHECK (connector_id ~ '^[a-z0-9_]+$')
      )
    `);

    await queryRunner.query(`
      -- Mirrors WorkflowConnectorSelectionEntity.workflow
      ALTER TABLE workflow_connector_selections
        ADD CONSTRAINT fk_workflow_connector_selections_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS workflow_connector_selections');
  }
}
