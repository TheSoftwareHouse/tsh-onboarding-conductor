import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowAgreementPendingOutboxEvent0023 implements MigrationInterface {
  name = '0023_allow_agreement_pending_outbox_event_2052259200000';

  /**
   * Admits `onboarding.agreement_pending` to the outbox's event-type vocabulary.
   *
   * `chk_client_webhook_outbox_event_type` has enumerated the allowed values since migration
   * `0006`, so a row carrying the agreement event was rejected by the database. The write is made
   * inside a `try` that logs and moves on, which meant the publish still answered 200 and still
   * reported the onboardings it had linked — the notification was simply never persisted.
   *
   * The table keeps every other part of its shape: no column is added, no column is widened, and
   * `onboarding_id` stays `NOT NULL`. Only the list of names the column may hold changes.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_event_type
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_event_type
      CHECK (
        event_type IN (
          'onboarding.created',
          'onboarding.state_changed',
          'onboarding.agreement_pending'
        )
      )
    `);
  }

  /**
   * Rows already carrying the agreement event would fail the narrower constraint, so they are
   * removed first. Reverting this migration reverts the feature that wrote them, and an
   * undeliverable row for an event the engine no longer emits is not worth keeping.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM client_webhook_outbox WHERE event_type = 'onboarding.agreement_pending'
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      DROP CONSTRAINT IF EXISTS chk_client_webhook_outbox_event_type
    `);

    await queryRunner.query(`
      ALTER TABLE client_webhook_outbox
      ADD CONSTRAINT chk_client_webhook_outbox_event_type
      CHECK (event_type IN ('onboarding.created', 'onboarding.state_changed'))
    `);
  }
}
