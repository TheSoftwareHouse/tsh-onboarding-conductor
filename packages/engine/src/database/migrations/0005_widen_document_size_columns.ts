import { MigrationInterface, QueryRunner } from 'typeorm';

export class WidenDocumentSizeColumns0005 implements MigrationInterface {
  name = '0005_widen_document_size_columns_1784764800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE onboarding_documents
      ALTER COLUMN requested_max_size_bytes TYPE BIGINT
      USING requested_max_size_bytes::BIGINT
    `);

    await queryRunner.query(`
      ALTER TABLE onboarding_documents
      ALTER COLUMN verified_size_bytes TYPE BIGINT
      USING verified_size_bytes::BIGINT
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.startTransaction();

    try {
      const rows = await queryRunner.query(`
        SELECT COUNT(*)::int AS exceeding_values
        FROM onboarding_documents
        WHERE requested_max_size_bytes::numeric > 2147483647
           OR (verified_size_bytes IS NOT NULL AND verified_size_bytes::numeric > 2147483647)
      `);
      const exceedingValues = Number(rows[0]?.exceeding_values ?? 0);

      if (exceedingValues > 0) {
        throw new Error(
          'Cannot rollback 0005_widen_document_size_columns_1784764800000 because onboarding_documents contains values above 2147483647 in requested_max_size_bytes or verified_size_bytes.',
        );
      }

      await queryRunner.query(`
        ALTER TABLE onboarding_documents
        ALTER COLUMN requested_max_size_bytes TYPE INTEGER
        USING requested_max_size_bytes::INTEGER
      `);

      await queryRunner.query(`
        ALTER TABLE onboarding_documents
        ALTER COLUMN verified_size_bytes TYPE INTEGER
        USING verified_size_bytes::INTEGER
      `);

      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }
}
