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
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        delivered_at TIMESTAMPTZ NULL,
        CONSTRAINT chk_client_webhook_outbox_event_type
          CHECK (event_type IN ('onboarding.created', 'onboarding.state_changed')),
        CONSTRAINT chk_client_webhook_outbox_endpoint_url_nonempty
          CHECK (btrim(endpoint_url) <> ''),
        CONSTRAINT chk_client_webhook_outbox_payload_object
          CHECK (jsonb_typeof(payload) = 'object'),
        CONSTRAINT chk_client_webhook_outbox_status
          CHECK (status IN ('PENDING', 'DELIVERED')),
        CONSTRAINT chk_client_webhook_outbox_attempts_non_negative
          CHECK (attempts >= 0),
        CONSTRAINT chk_client_webhook_outbox_delivery_timestamp_coherence
          CHECK (
            (status = 'PENDING' AND delivered_at IS NULL)
            OR (status = 'DELIVERED' AND delivered_at IS NOT NULL)
          )
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_client_webhook_outbox_onboarding_id
      ON client_webhook_outbox (onboarding_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_client_webhook_outbox_onboarding_id');
    await queryRunner.query('DROP TABLE IF EXISTS client_webhook_outbox');
  }
}
