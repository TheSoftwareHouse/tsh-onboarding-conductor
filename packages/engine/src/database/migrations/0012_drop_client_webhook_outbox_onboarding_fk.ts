import { MigrationInterface, QueryRunner } from 'typeorm';

export class DropClientWebhookOutboxOnboardingFk0012 implements MigrationInterface {
  name = '0012_drop_client_webhook_outbox_onboarding_fk_2051222400000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS fk_client_webhook_outbox_onboarding
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT fk_client_webhook_outbox_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings(id)
    `);
  }
}
