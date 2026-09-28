import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateEncryptionKeys0024 implements MigrationInterface {
  name = '0024_create_encryption_keys_2052345600000';

  /**
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
   *
   * The two `onboardings` indexes are what let the encryption sweep find its work by index rather
   * than by scanning. `idx_onboardings_encryption_key` is written for the envelope shape the
   * `onboardings.context` column transformer stores — `{ "__tsh_enc": ..., "k": "<key id>", "d":
   * ... }` — so "rows encrypted under key X" is an index condition on `k` (an equality against the
   * keys it holds; a btree cannot serve "any key other than X"). `idx_onboardings_plaintext_context`
   * is its complement, "rows not encrypted at all", which is what turning encryption on has to
   * sweep; it indexes nothing beyond `id` because the sweep only ever asks whether any such row
   * exists and which ids to claim next, and it is empty — so free to consult on every poll — once
   * every row is encrypted. The one query that uses neither is the admin-facing progress count
   * (`EncryptionKeysRepository.countSweepStatus`), which has no `WHERE` restricting `onboardings`
   * at all and is always a sequential scan — acceptable because it runs on an operator's `GET` and
   * on a sweep tick that has found work, never on the sweep's idle polls.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
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
      CREATE INDEX idx_onboardings_encryption_key
        ON onboardings ((context ->> 'k'))
        WHERE context ? '__tsh_enc'
    `);

    await queryRunner.query(`
      CREATE INDEX idx_onboardings_plaintext_context
        ON onboardings (id)
        WHERE NOT (context ? '__tsh_enc')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_onboardings_plaintext_context');
    await queryRunner.query('DROP INDEX IF EXISTS idx_onboardings_encryption_key');
    await queryRunner.query('DROP INDEX IF EXISTS uq_encryption_keys_active');
    await queryRunner.query('DROP TABLE IF EXISTS encryption_keys');
  }
}
