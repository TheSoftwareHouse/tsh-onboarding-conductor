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
        -- Declared last: it classifies each row's outcome and is appended after the shape it
        -- classifies, matching the physical column order this table has always had.
        entry_type VARCHAR(16) NOT NULL DEFAULT 'success',
        CONSTRAINT chk_audit_log_metadata_object
          CHECK (jsonb_typeof(metadata) = 'object'),
        CONSTRAINT chk_audit_log_before_object
          CHECK (before IS NULL OR jsonb_typeof(before) = 'object'),
        CONSTRAINT chk_audit_log_after_object
          CHECK (after IS NULL OR jsonb_typeof(after) = 'object'),
        CONSTRAINT chk_audit_log_entry_type
          CHECK (entry_type IN ('success', 'rejected', 'failed', 'observed'))
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

    /*
     * Partial rather than a composite on `(entry_type, occurred_at)`: it indexes only the rows an
     * error listing reads, which makes it a quarter of the size, and — the reason that matters on
     * an append-heavy table — Postgres maintains a partial index only for rows matching its
     * predicate, so the two thirds of writes that are `success` or `observed` never touch it.
     *
     * The sort columns match the audit list's own `ORDER BY occurred_at DESC, id DESC`, so the
     * filter, the ordering and the page window are one range scan with nothing discarded.
     *
     * If filtering by `success` or `observed` ever becomes a real query, that wants a composite on
     * `(entry_type, occurred_at DESC, id DESC)` instead; this index cannot serve it.
     */
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_log_errors
      ON audit_log (occurred_at DESC, id DESC)
      WHERE entry_type IN ('rejected', 'failed')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_errors');
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_resource_type_resource_id');
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_occurred_at');
    await queryRunner.query('DROP TABLE IF EXISTS audit_log');
  }
}
