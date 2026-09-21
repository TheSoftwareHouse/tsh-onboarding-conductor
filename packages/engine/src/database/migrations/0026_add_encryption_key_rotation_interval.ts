import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncryptionKeyRotationInterval0026 implements MigrationInterface {
  name = '0026_add_encryption_key_rotation_interval_2052518400000';

  /**
   * The automatic-rotation schedule lives on the key row it governs, rather than in a settings
   * table beside it: the row with `deleted_at IS NULL` is already the single piece of state that
   * says encryption is on (migration `0024`), so hanging the schedule off it keeps one source of
   * truth, and makes "a rotation restarts the countdown" a property of the new row's `created_at`
   * rather than a counter something has to remember to reset.
   *
   * `NULL` means no automatic rotation — the value every key created before this migration keeps,
   * so an upgrade never starts rewriting a deployment's onboardings on a schedule nobody chose.
   * Keys created from here on carry the interval the operator picked, defaulting to `1w`.
   *
   * No CHECK constraint on the token: the closed set lives in
   * `encryption/encryption-key-rotation.ts` and is enforced at the API boundary by the same
   * constant the column is written from, and a second copy in DDL is a copy that can drift.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE encryption_keys
        ADD COLUMN rotation_interval VARCHAR(8) NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('ALTER TABLE encryption_keys DROP COLUMN IF EXISTS rotation_interval');
  }
}
