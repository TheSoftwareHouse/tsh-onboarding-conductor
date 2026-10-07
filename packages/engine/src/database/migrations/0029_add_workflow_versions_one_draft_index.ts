import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowVersionsOneDraftIndex0029 implements MigrationInterface {
  name = '0029_add_workflow_versions_one_draft_index_2052777600000';

  /** A family holds at most one draft; the partial index is the guarantee behind the admin draft API (ADR 0034). */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_workflow_versions_one_draft
        ON workflow_versions (workflow_id)
        WHERE status = 'draft'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uq_workflow_versions_one_draft');
  }
}
