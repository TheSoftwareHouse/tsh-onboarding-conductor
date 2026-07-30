import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLog0010 implements MigrationInterface {
  name = '0010_create_audit_log_1785110400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        id UUID PRIMARY KEY,
        occurred_at TIMESTAMPTZ NOT NULL,
        actor_type VARCHAR(64) NOT NULL,
        actor_id VARCHAR(255) NOT NULL,
        action VARCHAR(255) NOT NULL,
        resource_type VARCHAR(64) NOT NULL,
        resource_id VARCHAR(255) NOT NULL,
        before JSONB NULL,
        after JSONB NULL,
        metadata JSONB NOT NULL,
        hash_prev VARCHAR(255) NULL,
        hash_self VARCHAR(255) NULL,
        CONSTRAINT chk_audit_log_metadata_object
          CHECK (jsonb_typeof(metadata) = 'object'),
        CONSTRAINT chk_audit_log_before_object
          CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
        CONSTRAINT chk_audit_log_after_object
          CHECK (after IS NULL OR jsonb_typeof(after) = 'object')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_occurred_at
      ON audit_log (occurred_at)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_resource_type_resource_id
      ON audit_log (resource_type, resource_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_resource_type_resource_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_occurred_at');
    await queryRunner.query('DROP TABLE IF EXISTS audit_log');
  }
}
