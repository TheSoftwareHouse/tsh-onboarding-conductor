import { MigrationInterface, QueryRunner } from 'typeorm';

const OWNED_TABLES = ['agreements', 'workflows', 'onboardings'];

/**
 * Engine data belongs to a better-auth organization (ADR 0054). Seeds the default organization
 * when none exists, then gives agreements, workflows and onboardings a NOT NULL owner, backfilled
 * with the oldest organization. Runs in TypeORM's one transaction, so the locks below are held
 * until commit; `lock_timeout` turns a blocked lock into a failed boot instead of a hang.
 */
export class OrganizationOwnership0004 implements MigrationInterface {
  name = '0004_organization_ownership_2056147200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    await queryRunner.query('ALTER TABLE auth."organization" ADD COLUMN "parentId" TEXT');
    await queryRunner.query(`
      ALTER TABLE auth."organization"
        ADD CONSTRAINT fk_auth_organization_parent
        FOREIGN KEY ("parentId") REFERENCES auth."organization" ("id") ON DELETE RESTRICT
    `);

    await queryRunner.query(`
      INSERT INTO auth."organization" ("id", "name", "slug", "createdAt")
      SELECT gen_random_uuid()::text, 'Default organisation', 'default', now()
      WHERE NOT EXISTS (SELECT 1 FROM auth."organization")
    `);

    for (const table of OWNED_TABLES) {
      await queryRunner.query(`ALTER TABLE ${table} ADD COLUMN organization_id TEXT`);
      await queryRunner.query(`
        UPDATE ${table}
        SET organization_id = (SELECT id FROM auth."organization" ORDER BY "createdAt", id LIMIT 1)
      `);
      await queryRunner.query(`ALTER TABLE ${table} ALTER COLUMN organization_id SET NOT NULL`);
      await queryRunner.query(`
        ALTER TABLE ${table}
          ADD CONSTRAINT fk_${table}_organization
          FOREIGN KEY (organization_id) REFERENCES auth."organization" (id) ON DELETE RESTRICT
      `);
      await queryRunner.query(
        `CREATE INDEX idx_${table}_organization ON ${table} (organization_id)`,
      );
    }
  }

  /** Leaves the default organization in place: better-auth permission data may already point at it. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`SET LOCAL lock_timeout = '5s'`);

    for (const table of [...OWNED_TABLES].reverse()) {
      await queryRunner.query(`DROP INDEX IF EXISTS idx_${table}_organization`);
      await queryRunner.query(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS fk_${table}_organization`,
      );
      await queryRunner.query(`ALTER TABLE ${table} DROP COLUMN IF EXISTS organization_id`);
    }

    await queryRunner.query(
      'ALTER TABLE auth."organization" DROP CONSTRAINT IF EXISTS fk_auth_organization_parent',
    );
    await queryRunner.query('ALTER TABLE auth."organization" DROP COLUMN IF EXISTS "parentId"');
  }
}
