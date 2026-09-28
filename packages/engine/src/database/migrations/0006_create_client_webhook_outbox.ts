import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateClientWebhookOutbox0006 implements MigrationInterface {
  name = '0006_create_client_webhook_outbox_1784592000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE client_webhook_outbox (
        id UUID PRIMARY KEY,
        onboarding_id UUID NOT NULL,
        event_type VARCHAR(64) NOT NULL,
        endpoint_url TEXT NOT NULL,
        payload JSONB NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        base_delay_ms INTEGER NOT NULL DEFAULT 5000,
        backoff_multiplier INTEGER NOT NULL DEFAULT 2,
        max_backoff_ms INTEGER NOT NULL DEFAULT 300000,
        next_delivery_at TIMESTAMPTZ NULL,
        sending_started_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_client_webhook_outbox_event_type
          CHECK (
            event_type IN (
              'onboarding.created',
              'onboarding.state_changed',
              'onboarding.agreement_pending'
            )
          ),
        CONSTRAINT chk_client_webhook_outbox_endpoint_url_nonempty
          CHECK (btrim(endpoint_url) <> ''),
        CONSTRAINT chk_client_webhook_outbox_payload_object
          CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT chk_client_webhook_outbox_status
          CHECK (status IN ('PENDING', 'SENDING', 'DELIVERED', 'ERROR')),
        CONSTRAINT chk_client_webhook_outbox_attempts_non_negative
          CHECK (attempts >= 0),
        CONSTRAINT chk_client_webhook_outbox_attempts_policy
          CHECK (
            attempts >= 0
            AND max_attempts >= 1
            AND base_delay_ms >= 0
            AND backoff_multiplier >= 1
            AND max_backoff_ms >= 0
            AND base_delay_ms <= max_backoff_ms
          ),
        CONSTRAINT chk_client_webhook_outbox_delivery_timestamp_coherence
          CHECK (
            (status IN ('PENDING', 'SENDING', 'ERROR') AND delivered_at IS NULL)
            OR (status = 'DELIVERED' AND delivered_at IS NOT NULL)
          ),
        CONSTRAINT chk_client_webhook_outbox_lease_state
          CHECK (
            (status = 'SENDING' AND sending_started_at IS NOT NULL)
            OR (status <> 'SENDING' AND sending_started_at IS NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_client_webhook_outbox_onboarding_id
      ON client_webhook_outbox (onboarding_id)
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
      CREATE TRIGGER trg_client_webhook_outbox_default_next_delivery_at
      BEFORE INSERT ON client_webhook_outbox
      FOR EACH ROW
      EXECUTE FUNCTION set_client_webhook_outbox_next_delivery_at()
    `);

    await queryRunner.query(`
      CREATE INDEX idx_client_webhook_outbox_pending_due
      ON client_webhook_outbox (next_delivery_at, id)
      WHERE status = 'PENDING'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_client_webhook_outbox_pending_due');
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS trg_client_webhook_outbox_default_next_delivery_at
      ON client_webhook_outbox
    `);
    await queryRunner.query('DROP FUNCTION IF EXISTS set_client_webhook_outbox_next_delivery_at()');
    await queryRunner.query('DROP INDEX IF EXISTS idx_client_webhook_outbox_onboarding_id');
    await queryRunner.query('DROP TABLE IF EXISTS client_webhook_outbox');
  }
}
