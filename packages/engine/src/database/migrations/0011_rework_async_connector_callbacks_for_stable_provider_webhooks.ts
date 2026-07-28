import { MigrationInterface, QueryRunner } from 'typeorm';

export class ReworkAsyncConnectorCallbacksForStableProviderWebhooks0011 implements MigrationInterface {
  name = '0011_rework_async_connector_callbacks_for_stable_provider_webhooks_1785369600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const waitingRows = (await queryRunner.query(`
      SELECT COUNT(*)::int AS count
      FROM async_connector_pending_callbacks
      WHERE state = 'WAITING'
        AND capability_digest IS NOT NULL
    `)) as Array<{ count: number | string }>;

    const waitingCount = Number(waitingRows[0]?.count ?? 0);
    if (waitingCount > 0) {
      throw new Error(
        'ASYNC_CONNECTOR_PENDING_LEGACY_WAITING_ROWS_EXIST: migration aborted before cutover',
      );
    }

    await queryRunner.query(`
      ALTER TABLE async_connector_pending_callbacks
      ADD COLUMN provider_key VARCHAR(100),
      ADD COLUMN correlation_reference VARCHAR(255)
    `);

    await queryRunner.query(`
      ALTER TABLE async_connector_pending_callbacks
      DROP CONSTRAINT IF EXISTS chk_async_connector_pending_callbacks_capability_digest_nonempty
    `);

    await queryRunner.query(`
      ALTER TABLE async_connector_pending_callbacks
      DROP COLUMN capability_digest
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_async_connector_pending_callbacks_provider_correlation
      ON async_connector_pending_callbacks (provider_key, correlation_reference)
      WHERE provider_key IS NOT NULL AND correlation_reference IS NOT NULL
    `);
  }

  public async down(): Promise<void> {
    throw new Error(
      'DOWN_MIGRATION_NOT_SUPPORTED_FOR_0011_REWORK_ASYNC_CONNECTOR_CALLBACKS_FOR_STABLE_PROVIDER_WEBHOOKS',
    );
  }
}
