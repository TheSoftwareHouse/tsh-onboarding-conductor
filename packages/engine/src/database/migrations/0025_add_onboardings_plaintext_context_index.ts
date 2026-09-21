import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOnboardingsPlaintextContextIndex0025 implements MigrationInterface {
  name = '0025_add_onboardings_plaintext_context_index_2052432000000';

  /**
   * The second half of what the encryption sweep needs to find its work by index. Migration `0024`'s
   * `idx_onboardings_encryption_key` serves "rows encrypted under key X"; this partial index serves
   * "rows not encrypted at all", which is what turning encryption on has to sweep. It indexes
   * nothing beyond `id` because the sweep only ever asks whether any such row exists and which ids
   * to claim next — and it is empty, so free to consult on every poll, once every row is encrypted.
   */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_onboardings_plaintext_context
        ON onboardings (id)
        WHERE NOT (context ? '__tsh_enc')
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS idx_onboardings_plaintext_context');
  }
}
