import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAuditLogEntryType0021 implements MigrationInterface {
  name = '0021_add_audit_log_entry_type_2052086400000';

  /**
   * Classifies each audit row as a kind of record, so "every error" is one indexable predicate
   * rather than a list of action names a caller has to keep in step with the contract.
   *
   * The backfill repeats the classification as SQL literals rather than importing the map from
   * `audit.types.ts`: a migration is a snapshot of the schema at a point in time and must keep
   * applying the same way after that map changes.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE audit_log
        ADD COLUMN IF NOT EXISTS entry_type VARCHAR(16) NOT NULL DEFAULT 'success'
    `);

    await queryRunner.query(`
      UPDATE audit_log SET entry_type = 'rejected'
      WHERE action IN (
        'onboarding.rejected_attempt',
        'webhook.inbound_callback_rejected',
        'webhook.outbound_resend_not_found',
        'auth.token_rejected',
        'auth.role_missing',
        'connector.result_rejected',
        'connector.result_invalid_data',
        'api.request_rejected'
      )
    `);

    await queryRunner.query(`
      UPDATE audit_log SET entry_type = 'failed'
      WHERE action IN (
        'webhook.inbound_callback_mapping_failed',
        'webhook.outbound_intent_failed',
        'webhook.outbound_delivery_failed',
        'webhook.outbound_endpoint_resolution_failed',
        'webhook.outbound_poll_failed',
        'webhook.outbound_dispatch_failed',
        'webhook.outbound_queue_job_failed',
        'webhook.outbound_lease_expired',
        'auth.verification_unavailable',
        'connector.failure_retried',
        'connector.failure_fell_back',
        'connector.failure_ignored',
        'connector.failure_propagated',
        'connector.execution_unavailable',
        'api.request_failed'
      )
    `);

    await queryRunner.query(`
      UPDATE audit_log SET entry_type = 'observed'
      WHERE action IN (
        'webhook.inbound_signature_skipped',
        'webhook.outbound_notification_suppressed',
        'webhook.outbound_notification_dropped',
        'webhook.outbound_finalization_noop',
        'webhook.outbound_resend_noop',
        'auth.access_unauthenticated'
      )
    `);

    // Added after the backfill so no existing row can violate it.
    await queryRunner.query(`
      ALTER TABLE audit_log
        ADD CONSTRAINT chk_audit_log_entry_type
        CHECK (entry_type IN ('success', 'rejected', 'failed', 'observed'))
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
    // Dropped before the column its predicate depends on.
    await queryRunner.query('DROP INDEX IF EXISTS idx_audit_log_errors');
    await queryRunner.query(
      'ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS chk_audit_log_entry_type',
    );
    await queryRunner.query('ALTER TABLE audit_log DROP COLUMN IF EXISTS entry_type');
  }
}
