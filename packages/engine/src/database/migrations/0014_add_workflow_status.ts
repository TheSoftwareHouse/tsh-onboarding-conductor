import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWorkflowStatus0014 implements MigrationInterface {
  name = '0014_add_workflow_status_2051395200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflows
      ADD COLUMN IF NOT EXISTS status VARCHAR(16) NOT NULL DEFAULT 'published'
    `);

    await queryRunner.query(`
      ALTER TABLE workflows
      DROP CONSTRAINT IF EXISTS chk_workflows_status
    `);

    await queryRunner.query(`
      ALTER TABLE workflows
      ADD CONSTRAINT chk_workflows_status
        CHECK (status IN ('draft', 'published'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM workflows
      WHERE status = 'draft'
    `);

    if (count > 0) {
      throw new Error(
        'Cannot rollback migration 0014 because workflows rows still use draft status; rollback is blocked to avoid publishing unfinished revisions.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE workflows
      DROP CONSTRAINT IF EXISTS chk_workflows_status,
      DROP COLUMN IF EXISTS status
    `);
  }
}
