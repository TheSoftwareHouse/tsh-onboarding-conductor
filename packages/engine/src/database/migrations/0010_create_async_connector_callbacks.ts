import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAsyncConnectorCallbacks0010 implements MigrationInterface {
  name = '0010_create_async_connector_callbacks_1785283200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE async_connector_pending_callbacks (
        id UUID PRIMARY KEY,
        onboarding_id UUID NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        connector_name VARCHAR(100) NOT NULL,
        connector_type VARCHAR(100) NOT NULL,
        connector_order INTEGER NOT NULL,
        capability_digest CHAR(64) NOT NULL,
        state VARCHAR(16) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_async_connector_pending_callbacks_onboarding
          FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE RESTRICT,
        CONSTRAINT chk_async_connector_pending_callbacks_step_name_nonempty
          CHECK (btrim(step_name) <> ''),
        CONSTRAINT chk_async_connector_pending_callbacks_connector_name_nonempty
          CHECK (btrim(connector_name) <> ''),
        CONSTRAINT chk_async_connector_pending_callbacks_connector_type_nonempty
          CHECK (btrim(connector_type) <> ''),
        CONSTRAINT chk_async_connector_pending_callbacks_connector_order_positive
          CHECK (connector_order > 0),
        CONSTRAINT chk_async_connector_pending_callbacks_capability_digest_nonempty
          CHECK (btrim(capability_digest) <> ''),
        CONSTRAINT chk_async_connector_pending_callbacks_state
          CHECK (state IN ('WAITING', 'COMPLETED'))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_async_connector_pending_callbacks_lookup
        ON async_connector_pending_callbacks (onboarding_id, step_name, connector_name, connector_type, connector_order, state)
    `);

    await queryRunner.query(`
      CREATE TABLE async_connector_callback_receipts (
        id UUID PRIMARY KEY,
        pending_callback_id UUID NOT NULL,
        connector_type VARCHAR(100) NOT NULL,
        provider_event_id VARCHAR(255) NOT NULL,
        state VARCHAR(16) NOT NULL,
        normalized_outcome_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT fk_async_connector_callback_receipts_pending
          FOREIGN KEY (pending_callback_id) REFERENCES async_connector_pending_callbacks (id) ON DELETE RESTRICT,
        CONSTRAINT chk_async_connector_callback_receipts_connector_type_nonempty
          CHECK (btrim(connector_type) <> ''),
        CONSTRAINT chk_async_connector_callback_receipts_provider_event_id_nonempty
          CHECK (btrim(provider_event_id) <> ''),
        CONSTRAINT chk_async_connector_callback_receipts_state
          CHECK (state IN ('RECEIVED', 'APPLIED')),
        CONSTRAINT chk_async_connector_callback_receipts_metadata_object
          CHECK (jsonb_typeof(normalized_outcome_metadata) = 'object'),
        CONSTRAINT uq_async_connector_callback_receipts_pending_event
          UNIQUE (pending_callback_id, provider_event_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_async_connector_callback_receipts_pending_callback_id
        ON async_connector_callback_receipts (pending_callback_id)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_async_connector_callback_receipts_pending_callback_id',
    );
    await queryRunner.query('DROP TABLE IF EXISTS async_connector_callback_receipts');

    await queryRunner.query('DROP INDEX IF EXISTS idx_async_connector_pending_callbacks_lookup');
    await queryRunner.query('DROP TABLE IF EXISTS async_connector_pending_callbacks');
  }
}
