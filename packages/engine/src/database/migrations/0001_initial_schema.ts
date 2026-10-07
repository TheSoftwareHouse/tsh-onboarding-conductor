import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The engine's whole schema in one migration. Nothing had been deployed when the incremental
 * history was folded into it, so it states the schema as it is rather than how it got there.
 *
 * Tables are created in dependency order, each followed by its own indexes. Foreign keys come
 * last, each as a standalone `ALTER TABLE … ADD CONSTRAINT` mirroring the relation its entity
 * declares (ADR 0027; `test/foreign-keys.e2e-spec.ts` holds the two equal).
 */
export class InitialSchema0001 implements MigrationInterface {
  name = '0001_initial_schema_1735689600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // A trivial table proving migrations ran; the health e2e reads it.
    await queryRunner.query(`
      CREATE TABLE _engine_alive (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await queryRunner.query(`
      INSERT INTO _engine_alive (id)
      VALUES (1)
    `);

    /*
     * `pending_connector` is the connector an onboarding is parked on while it awaits an
     * asynchronous callback — `{connectorId, connectorName, connectorOrder, providerReference?}`.
     * Plain JSONB, never encrypted: the callback resolver reads it without the encryption port.
     * `NULL` while the onboarding is not parked.
     */
    await queryRunner.query(`
      CREATE TABLE onboardings (
        id UUID PRIMARY KEY,
        workflow_version_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        current_step VARCHAR(100) NULL,
        context JSONB NOT NULL DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ NULL,
        rejection_reason VARCHAR(100) NULL,
        scores JSONB NOT NULL DEFAULT '{}'::jsonb,
        pending_connector JSONB NULL,
        CONSTRAINT chk_onboardings_current_step_nonempty
          CHECK (current_step IS NULL OR btrim(current_step) <> ''),
        CONSTRAINT chk_onboardings_context_object
          CHECK (jsonb_typeof(context) = 'object'),
        CONSTRAINT chk_onboardings_status
          CHECK (status IN ('awaiting_user', 'awaiting_manual_review', 'approved', 'rejected', 'invalid')),
        CONSTRAINT chk_onboardings_lifecycle_state
          CHECK (
            (status IN ('awaiting_user', 'awaiting_manual_review') AND current_step IS NOT NULL AND completed_at IS NULL)
            OR (status IN ('approved', 'rejected', 'invalid') AND current_step IS NULL AND completed_at IS NOT NULL)
          ),
        CONSTRAINT chk_onboardings_rejection_reason_terminal
          CHECK (
            rejection_reason IS NULL
            OR (
              status = 'rejected'
              AND rejection_reason IN (
                'ATTEMPTS_EXHAUSTED',
                'CHALLENGE_EXPIRED',
                'CHALLENGE_NOT_FOUND',
                'CONNECTOR_REJECTED'
              )
            )
          ),
        CONSTRAINT chk_onboardings_pending_connector_object
          CHECK (pending_connector IS NULL OR jsonb_typeof(pending_connector) = 'object')
      )
    `);

    /*
     * The two encryption indexes let the encryption sweep find its work by index rather than by
     * scanning. `idx_onboardings_encryption_key` is written for the envelope shape the
     * `onboardings.context` column transformer stores — `{ "__tsh_enc": ..., "k": "<key id>", "d":
     * ... }` — so "rows encrypted under key X" is an index condition on `k` (an equality against
     * the keys it holds; a btree cannot serve "any key other than X").
     * `idx_onboardings_plaintext_context` is its complement, "rows not encrypted at all", which is
     * what turning encryption on has to sweep; it indexes nothing beyond `id` because the sweep
     * only ever asks whether any such row exists and which ids to claim next, and it is empty — so
     * free to consult on every poll — once every row is encrypted. The one query that uses neither
     * is the admin-facing progress count (`EncryptionKeysRepository.countSweepStatus`), which has
     * no `WHERE` restricting `onboardings` at all and is always a sequential scan — acceptable
     * because it runs on an operator's `GET` and on a sweep tick that has found work, never on the
     * sweep's idle polls.
     */
    await queryRunner.query(`
      CREATE INDEX idx_onboardings_encryption_key
        ON onboardings ((context ->> 'k'))
        WHERE context ? '__tsh_enc'
    `);

    await queryRunner.query(`
      CREATE INDEX idx_onboardings_plaintext_context
        ON onboardings (id)
        WHERE NOT (context ? '__tsh_enc')
    `);

    // Serves the admin workflows list's in-progress count; partial, so it holds only unfinished
    // onboardings (ADR 0032).
    await queryRunner.query(`
      CREATE INDEX idx_onboardings_in_progress_version
        ON onboardings (workflow_version_id)
        WHERE completed_at IS NULL
    `);

    // Serves the admin list's order and the CSV export's keyset batches (ADR 0044).
    await queryRunner.query(`
      CREATE INDEX idx_onboardings_created_at_id
        ON onboardings (created_at DESC, id DESC)
    `);

    await queryRunner.query(`
      CREATE TABLE onboarding_documents (
        id UUID PRIMARY KEY,
        onboarding_id UUID NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        field_name VARCHAR(100) NOT NULL,
        status VARCHAR(20) NOT NULL,
        staging_object_key VARCHAR(512) NOT NULL,
        final_object_key VARCHAR(512) NULL,
        requested_content_type VARCHAR(255) NOT NULL,
        requested_max_size_bytes BIGINT NOT NULL,
        verified_content_type VARCHAR(255) NULL,
        verified_size_bytes BIGINT NULL,
        verified_etag VARCHAR(255) NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        completed_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT chk_onboarding_documents_status
          CHECK (status IN ('pending', 'completed', 'expired')),
        CONSTRAINT chk_onboarding_documents_step_name_nonempty
          CHECK (btrim(step_name) <> ''),
        CONSTRAINT chk_onboarding_documents_field_name_nonempty
          CHECK (btrim(field_name) <> ''),
        CONSTRAINT chk_onboarding_documents_requested_max_size_positive
          CHECK (requested_max_size_bytes > 0),
        CONSTRAINT chk_onboarding_documents_verified_size_positive
          CHECK (verified_size_bytes IS NULL OR verified_size_bytes > 0),
        CONSTRAINT chk_onboarding_documents_staging_key_nonempty
          CHECK (btrim(staging_object_key) <> ''),
        CONSTRAINT chk_onboarding_documents_final_key_nonempty
          CHECK (final_object_key IS NULL OR btrim(final_object_key) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_onboarding_documents_onboarding_id
        ON onboarding_documents (onboarding_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_staging_object_key
        ON onboarding_documents (staging_object_key)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_final_object_key
        ON onboarding_documents (final_object_key)
        WHERE final_object_key IS NOT NULL
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX ux_onboarding_documents_pending_per_onboarding_field
        ON onboarding_documents (onboarding_id, step_name, field_name)
        WHERE status = 'pending'
    `);

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

    await queryRunner.query(`
      CREATE TABLE audit_log (
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
      CREATE INDEX idx_audit_log_occurred_at
      ON audit_log (occurred_at)
    `);

    await queryRunner.query(`
      CREATE INDEX idx_audit_log_resource_type_resource_id
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
      CREATE INDEX idx_audit_log_errors
      ON audit_log (occurred_at DESC, id DESC)
      WHERE entry_type IN ('rejected', 'failed')
    `);

    await queryRunner.query(`
      CREATE TABLE workflows (
        workflow_id UUID NOT NULL,
        -- The document's id: what the HTTP contract calls workflowId. Not a display label.
        key VARCHAR(100) NOT NULL,
        -- The display label of the highest stored version declaring a root name; null until one does.
        name VARCHAR(200),
        -- The scope directory whose file created the family; every revision inherits it.
        scope VARCHAR(32) NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflows PRIMARY KEY (workflow_id),
        CONSTRAINT uq_workflows_key UNIQUE (key),
        CONSTRAINT chk_workflows_key_nonempty
          CHECK (btrim(key) <> ''),
        CONSTRAINT chk_workflows_name_nonempty
          CHECK (name IS NULL OR btrim(name) <> ''),
        CONSTRAINT chk_workflows_scope
          CHECK (scope IN ('built-in', 'fixtures', 'users'))
      )
    `);

    await queryRunner.query(`
      CREATE TABLE workflow_versions (
        workflow_version_id UUID NOT NULL,
        workflow_id UUID NOT NULL,
        version INTEGER NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'published',
        -- JSON, not JSONB: jsonb normalizes objects and reorders their keys,
        -- and a workflow's field order is the order clients render fields in.
        definition JSON NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_workflow_versions PRIMARY KEY (workflow_version_id),
        CONSTRAINT uq_workflow_versions_workflow_version UNIQUE (workflow_id, version),
        CONSTRAINT chk_workflow_versions_version_positive
          CHECK (version > 0),
        CONSTRAINT chk_workflow_versions_definition_object
          CHECK (json_typeof(definition) = 'object'),
        CONSTRAINT chk_workflow_versions_status
          CHECK (status IN ('draft', 'published', 'retired'))
      )
    `);

    // A family holds at most one draft; the partial index is the guarantee behind the admin draft
    // API (ADR 0034).
    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_workflow_versions_one_draft
        ON workflow_versions (workflow_id)
        WHERE status = 'draft'
    `);

    /*
     * One row per (workflow family, version, step): the connector id an operator bound to that
     * step of that version at runtime, replacing the primary connector's `id` (ADR 0042).
     * `step_name` is not a foreign key — it names a step inside the versions' JSON documents.
     * `connector_id` carries the same shape check as `connectors.id`; whether an adapter with that
     * id exists is a runtime question, answered by the registered adapters.
     */
    await queryRunner.query(`
      CREATE TABLE workflow_connector_selections (
        workflow_id UUID NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        connector_id VARCHAR(64) NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by VARCHAR(255) NULL,
        version INTEGER NOT NULL,
        CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, version, step_name),
        CONSTRAINT chk_workflow_connector_selections_version_positive CHECK (version > 0),
        CONSTRAINT chk_workflow_connector_selections_step_name_nonempty
          CHECK (btrim(step_name) <> ''),
        CONSTRAINT chk_workflow_connector_selections_connector_id
          CHECK (connector_id ~ '^[a-z0-9_]+$')
      )
    `);

    /*
     * One row per connector, keyed by the `id` its adapter declares — `otp`, `smtp` —
     * which is also the value a workflow step's connector declaration names. `type` classifies it
     * along the same axis a workflow's `type` uses, so an operator can ask for every `messaging`
     * connector without knowing which providers implement it.
     *
     * No CHECK constraint on `type`: the allowed set is `CONNECTOR_TYPES` in `@tsh/ddl-schema`,
     * every declaration is validated against it when a workflow loads, and duplicating the list
     * here would make adding a capability a migration.
     */
    await queryRunner.query(`
      CREATE TABLE connectors (
        id VARCHAR(64) NOT NULL,
        type VARCHAR(32) NOT NULL,
        -- Plain JSON: confidentiality at rest is the deployment database's responsibility
        -- (an encrypted volume or a managed instance's disk encryption), not this table's.
        settings JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_by VARCHAR(255) NULL,
        CONSTRAINT pk_connectors PRIMARY KEY (id),
        CONSTRAINT chk_connectors_id
          CHECK (id ~ '^[a-z0-9_]+$')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE agreements (
        id UUID NOT NULL,
        workflow_id UUID,
        key VARCHAR(100) NOT NULL,
        type VARCHAR(64) NOT NULL,
        current_version_id UUID,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_agreements PRIMARY KEY (id),
        CONSTRAINT uq_agreements_key UNIQUE (key),
        CONSTRAINT ck_agreements_key_not_empty CHECK (btrim(key) <> '')
      )
    `);

    await queryRunner.query(`
      CREATE TABLE agreement_versions (
        agreement_version_id UUID NOT NULL,
        agreement_id UUID NOT NULL,
        version INTEGER NOT NULL,
        published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_agreement_versions PRIMARY KEY (agreement_version_id),
        CONSTRAINT uq_agreement_versions_agreement_version UNIQUE (agreement_id, version),
        CONSTRAINT ck_agreement_versions_version_positive CHECK (version > 0)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE onboarding_agreements (
        onboarding_id UUID NOT NULL,
        agreement_version_id UUID NOT NULL,
        status VARCHAR(32) NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT pk_onboarding_agreements PRIMARY KEY (onboarding_id, agreement_version_id),
        CONSTRAINT ck_onboarding_agreements_status CHECK (status IN ('pending', 'accepted')),
        CONSTRAINT ck_onboarding_agreements_accepted_at
          CHECK ((status = 'accepted') = (accepted_at IS NOT NULL))
      )
    `);

    await queryRunner.query(`
      CREATE INDEX idx_onboarding_agreements_agreement_version
        ON onboarding_agreements (agreement_version_id)
    `);

    /*
     * `encryption_keys` holds the full history of data keys that have ever protected
     * `onboardings.context`, each wrapped by the key-encryption key (`ENCRYPTION_KEY`) rather than
     * stored in the clear — a table of usable keys sitting beside the ciphertext it protects would
     * defeat the feature's whole threat model.
     *
     * `deleted_at IS NULL` marks the single active key; soft-deleting the previous one and
     * inserting the new one happen in one transaction, so there is never a moment with zero or two
     * active rows. `uq_encryption_keys_active` makes that invariant the database's, not the
     * application's: the indexed expression evaluates to `true` for every row the partial predicate
     * admits, so a second such row collides with the first and is rejected outright.
     *
     * The active row also carries the two pieces of operator intent the engine derives its work
     * from, rather than a settings table beside it: `rotation_interval` is how often the engine
     * rotates the key on its own (`NULL` for never; the closed set of tokens lives in
     * `encryption/encryption-key-rotation.ts` and is enforced at the API boundary, so no CHECK
     * duplicates it here), and `reencrypt_requested_at` is a standing request to move every stored
     * onboarding onto this key, set by `POST /v1/admin/encryption/reencryption` and cleared by the
     * sweep once nothing is left to move, so the request is self-retiring and a replica restarting
     * mid-run resumes from the table rather than from memory.
     */
    await queryRunner.query(`
      CREATE TABLE encryption_keys (
        id UUID NOT NULL,
        wrapped_key TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        created_by VARCHAR(255) NULL,
        activated_at TIMESTAMPTZ NOT NULL,
        deleted_at TIMESTAMPTZ NULL,
        rotation_interval VARCHAR(8) NULL,
        reencrypt_requested_at TIMESTAMPTZ NULL,
        CONSTRAINT pk_encryption_keys PRIMARY KEY (id)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX uq_encryption_keys_active
        ON encryption_keys ((deleted_at IS NULL))
        WHERE deleted_at IS NULL
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingDocumentEntity.onboarding
      ALTER TABLE onboarding_documents
        ADD CONSTRAINT fk_onboarding_documents_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors WorkflowVersionEntity.workflow
      ALTER TABLE workflow_versions
        ADD CONSTRAINT fk_workflow_versions_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingEntity.workflowVersion
      ALTER TABLE onboardings
        ADD CONSTRAINT fk_onboardings_workflow_version
        FOREIGN KEY (workflow_version_id) REFERENCES workflow_versions (workflow_version_id) ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      -- Mirrors WorkflowConnectorSelectionEntity.workflow
      ALTER TABLE workflow_connector_selections
        ADD CONSTRAINT fk_workflow_connector_selections_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors AgreementEntity.workflow
      ALTER TABLE agreements
        ADD CONSTRAINT fk_agreements_workflow
        FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      -- Mirrors AgreementEntity.currentVersion
      ALTER TABLE agreements
        ADD CONSTRAINT fk_agreements_current_version
        FOREIGN KEY (current_version_id) REFERENCES agreement_versions (agreement_version_id) ON DELETE SET NULL
    `);

    await queryRunner.query(`
      -- Mirrors AgreementVersionEntity.agreement
      ALTER TABLE agreement_versions
        ADD CONSTRAINT fk_agreement_versions_agreement
        FOREIGN KEY (agreement_id) REFERENCES agreements (id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.onboarding
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_onboarding
        FOREIGN KEY (onboarding_id) REFERENCES onboardings (id) ON DELETE CASCADE
    `);

    await queryRunner.query(`
      -- Mirrors OnboardingAgreementEntity.agreementVersion
      ALTER TABLE onboarding_agreements
        ADD CONSTRAINT fk_onboarding_agreements_agreement_version
        FOREIGN KEY (agreement_version_id) REFERENCES agreement_versions (agreement_version_id) ON DELETE RESTRICT
    `);

    // `OnboardingAgreementStatusView` declares the same expression; its spec holds the two equal.
    await queryRunner.query(`
      CREATE VIEW onboarding_agreement_statuses AS
      WITH latest AS (
        SELECT agreement_id, MAX(version) AS version FROM agreement_versions GROUP BY agreement_id
      ), per_agreement AS (
        SELECT oa.onboarding_id, av.agreement_id,
               MAX(CASE WHEN oa.status = 'accepted' THEN av.version END) AS accepted_version
          FROM onboarding_agreements oa
          JOIN agreement_versions av ON av.agreement_version_id = oa.agreement_version_id
         GROUP BY oa.onboarding_id, av.agreement_id
      )
      SELECT pa.onboarding_id,
             CASE WHEN bool_or(pa.accepted_version IS NULL)     THEN 'not_accepted'
                  WHEN bool_or(pa.accepted_version < l.version) THEN 'outdated'
                  ELSE 'current' END AS agreement_status
        FROM per_agreement pa JOIN latest l ON l.agreement_id = pa.agreement_id
       GROUP BY pa.onboarding_id
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP VIEW IF EXISTS onboarding_agreement_statuses');
    // One statement, so the tables' foreign keys to each other — `agreements` and
    // `agreement_versions` reference one another — never decide the order.
    await queryRunner.query(`
      DROP TABLE IF EXISTS
        encryption_keys,
        onboarding_agreements,
        agreement_versions,
        agreements,
        connectors,
        workflow_connector_selections,
        workflow_versions,
        workflows,
        audit_log,
        client_webhook_outbox,
        onboarding_documents,
        onboardings,
        _engine_alive
    `);
    await queryRunner.query('DROP FUNCTION IF EXISTS set_client_webhook_outbox_next_delivery_at()');
  }
}
