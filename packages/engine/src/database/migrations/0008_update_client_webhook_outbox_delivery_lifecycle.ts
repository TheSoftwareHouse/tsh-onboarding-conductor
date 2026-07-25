import { MigrationInterface, QueryRunner } from 'typeorm';

export class UpdateClientWebhookOutboxDeliveryLifecycle0008 implements MigrationInterface {
  name = '0008_update_client_webhook_outbox_delivery_lifecycle_1784937600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
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
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE client_webhook_outbox
      SET status = 'PENDING'
      WHERE status = 'SENDING'
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
        CHECK (status IN ('PENDING', 'DELIVERED'))
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_delivery_timestamp_coherence
        CHECK (
          (status = 'PENDING' AND delivered_at IS NULL)
          OR (status = 'DELIVERED' AND delivered_at IS NOT NULL)
        )
    `);
  }
}
