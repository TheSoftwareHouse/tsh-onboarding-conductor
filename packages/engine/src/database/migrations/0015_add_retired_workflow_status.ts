import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRetiredWorkflowStatus0015 implements MigrationInterface {
  name = '0015_add_retired_workflow_status_2051481600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE workflows
      DROP CONSTRAINT IF EXISTS chk_workflows_status
    `);

    await queryRunner.query(`
      ALTER TABLE workflows
      ADD CONSTRAINT chk_workflows_status
        CHECK (status IN ('draft', 'published', 'retired'))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM workflows
      WHERE status = 'retired'
    `);

    if (count > 0) {
      throw new Error(
        'Cannot rollback migration 0015 because workflows rows still use retired status; rollback is blocked to avoid reviving discontinued revisions.',
      );
    }

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
}
