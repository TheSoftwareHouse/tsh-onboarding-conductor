import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddClientWebhookOutboxRetryPolicy0011 implements MigrationInterface {
  name = '0011_add_client_webhook_outbox_retry_policy_2026073100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS base_delay_ms INTEGER NOT NULL DEFAULT 5000
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS backoff_multiplier INTEGER NOT NULL DEFAULT 2
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS max_backoff_ms INTEGER NOT NULL DEFAULT 300000
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS next_delivery_at TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD COLUMN IF NOT EXISTS sending_started_at TIMESTAMPTZ NULL
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION set_client_webhook_outbox_next_delivery_at()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.next_delivery_at IS NULL THEN
          NEW.next_delivery_at := NEW.created_at + (NEW.base_delay_ms * INTERVAL '1 millisecond');
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_client_webhook_outbox_default_next_delivery_at
      ON client_webhook_outbox
    `);

    await queryRunner.query(`
      CREATE TRIGGER trg_client_webhook_outbox_default_next_delivery_at
      BEFORE INSERT ON client_webhook_outbox
      FOR EACH ROW
      EXECUTE FUNCTION set_client_webhook_outbox_next_delivery_at()
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_status
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_delivery_timestamp_coherence
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_status
        CHECK (status IN ('PENDING', 'SENDING', 'DELIVERED', 'ERROR'))
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_attempts_policy
        CHECK (
          attempts >= 0
          AND max_attempts >= 1
          AND base_delay_ms >= 0
          AND backoff_multiplier >= 1
          AND max_backoff_ms >= 0
          AND base_delay_ms <= max_backoff_ms
        )
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_delivery_timestamp_coherence
        CHECK (
          (status IN ('PENDING', 'SENDING', 'ERROR') AND delivered_at IS NULL)
          OR (status = 'DELIVERED' AND delivered_at IS NOT NULL)
        )
    `);

    await queryRunner.query(`
      UPDATE client_webhook_outbox
      SET status = 'ERROR', next_delivery_at = NULL, sending_started_at = NULL
      WHERE status = 'SENDING'
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_lease_state
        CHECK (
          (status = 'SENDING' AND sending_started_at IS NOT NULL)
          OR (status <> 'SENDING' AND sending_started_at IS NULL)
        )
    `);

    await queryRunner.query(`
      UPDATE client_webhook_outbox
      SET status = 'ERROR', next_delivery_at = NULL, sending_started_at = NULL
      WHERE status = 'PENDING' AND attempts >= 5
    `);

    await queryRunner.query(`
      WITH ranked_rows AS (
        SELECT
          id,
          created_at,
          row_number() OVER (ORDER BY created_at, id) - 1 AS row_offset
        FROM client_webhook_outbox
        WHERE status = 'PENDING' AND attempts < 5
      )
      UPDATE client_webhook_outbox
      SET next_delivery_at = ranked_rows.created_at + interval '5 seconds' + (ranked_rows.row_offset * interval '40 milliseconds')
      FROM ranked_rows
      WHERE client_webhook_outbox.id = ranked_rows.id
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_client_webhook_outbox_pending_due
      ON client_webhook_outbox (next_delivery_at, id)
      WHERE status = 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE client_webhook_outbox
      SET status = 'PENDING'
      WHERE status = 'ERROR'
    `);

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_client_webhook_outbox_default_next_delivery_at
      ON client_webhook_outbox
    `);

    await queryRunner.query(`
      DROP FUNCTION IF EXISTS set_client_webhook_outbox_next_delivery_at()
    `);

    await queryRunner.query('DROP INDEX IF EXISTS idx_client_webhook_outbox_pending_due');

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_lease_state
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_attempts_policy
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_delivery_timestamp_coherence
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_status
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_status
        CHECK (status IN ('PENDING', 'SENDING', 'DELIVERED'))
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_delivery_timestamp_coherence
        CHECK (
          (status IN ('PENDING', 'SENDING') AND delivered_at IS NULL)
          OR (status = 'DELIVERED' AND delivered_at IS NOT NULL)
        )
    `);

    await queryRunner.query(
      'ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS sending_started_at',
    );
    await queryRunner.query(
      'ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS next_delivery_at',
    );
    await queryRunner.query(
      'ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS max_backoff_ms',
    );
    await queryRunner.query(
      'ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS backoff_multiplier',
    );
    await queryRunner.query(
      'ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS base_delay_ms',
    );
    await queryRunner.query('ALTER TABLE client_webhook_outbox DROP COLUMN IF EXISTS max_attempts');
  }
}
