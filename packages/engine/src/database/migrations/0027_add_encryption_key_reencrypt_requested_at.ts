import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncryptionKeyReencryptRequestedAt0027 implements MigrationInterface {
  name = '0027_add_encryption_key_reencrypt_requested_at_2052604800000';

  /**
   * The operator's standing request to move every stored onboarding onto the active key, for the
   * one case lazy rotation (record `0026`) does not answer: a data key whose unwrapped material
   * leaked, where rows written under it must stop naming it without waiting to be rewritten.
   *
   * A column on the key row rather than a job table or a start endpoint, for the reason migration
   * `0026` gives: the row with `deleted_at IS NULL` is already the only state that says what the
   * engine should be doing, and the sweep derives its target from that row alone. While this is
   * set the sweep widens its sources back to every key it can read; it clears the column once
   * nothing is left to move, so the request is self-retiring and a replica that restarts mid-run
   * resumes from the table rather than from memory.
   *
   * `NULL` means no request outstanding, which is every existing row and the steady state. The
   * timestamp is the audit-facing half — when it was asked for — and is never read to decide
   * whether the sweep runs; only its nullness is.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE encryption_keys
        ADD COLUMN reencrypt_requested_at TIMESTAMPTZ NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE encryption_keys DROP COLUMN IF EXISTS reencrypt_requested_at',
    );
  }
}
