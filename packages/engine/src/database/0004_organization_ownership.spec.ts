import { OrganizationOwnership0004 } from './migrations/0004_organization_ownership';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new OrganizationOwnership0004()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

const indexOfStatement = (statements: string[], prefix: string): number => {
  const index = statements.findIndex((statement) => statement.startsWith(prefix));

  expect(index).toBeGreaterThanOrEqual(0);

  return index;
};

describe('0004_organization_ownership', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(OrganizationOwnership0004.name).toBe('OrganizationOwnership0004');
    expect(new OrganizationOwnership0004().name).toBe('0004_organization_ownership_2056147200000');
  });

  it('sets lock_timeout before anything else', async () => {
    expect((await runMigration('up'))[0]).toBe("SET LOCAL lock_timeout = '5s'");
  });

  it('adds the nullable parentId with a restricting self foreign key', async () => {
    const statements = await runMigration('up');

    expect(statements).toContain('ALTER TABLE auth."organization" ADD COLUMN "parentId" TEXT');
    expect(statements).toContain(
      'ALTER TABLE auth."organization" ADD CONSTRAINT fk_auth_organization_parent FOREIGN KEY ("parentId") REFERENCES auth."organization" ("id") ON DELETE RESTRICT',
    );
  });

  it('inserts the default organization only when none exists, before any backfill', async () => {
    const statements = await runMigration('up');
    const insert = statements[indexOfStatement(statements, 'INSERT INTO auth."organization"')];

    expect(insert).toBe(
      `INSERT INTO auth."organization" ("id", "name", "slug", "createdAt") SELECT gen_random_uuid()::text, 'Default organisation', 'default', now() WHERE NOT EXISTS (SELECT 1 FROM auth."organization")`,
    );
    expect(statements.indexOf(insert)).toBeLessThan(
      indexOfStatement(statements, 'ALTER TABLE agreements ADD COLUMN'),
    );
  });

  describe.each(['agreements', 'workflows', 'onboardings'])('%s', (table) => {
    it('is owned in order: add column, backfill, SET NOT NULL, foreign key, index', async () => {
      const statements = await runMigration('up');
      const order = [
        indexOfStatement(statements, `ALTER TABLE ${table} ADD COLUMN organization_id TEXT`),
        indexOfStatement(statements, `UPDATE ${table} SET organization_id =`),
        indexOfStatement(
          statements,
          `ALTER TABLE ${table} ALTER COLUMN organization_id SET NOT NULL`,
        ),
        indexOfStatement(statements, `ALTER TABLE ${table} ADD CONSTRAINT`),
        indexOfStatement(statements, `CREATE INDEX idx_${table}_organization`),
      ];

      expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('backfills with the oldest organization', async () => {
      const statements = await runMigration('up');

      expect(statements).toContain(
        `UPDATE ${table} SET organization_id = (SELECT id FROM auth."organization" ORDER BY "createdAt", id LIMIT 1)`,
      );
    });

    it('restricts deletion of the owning organization and indexes the column', async () => {
      const statements = await runMigration('up');

      expect(statements).toContain(
        `ALTER TABLE ${table} ADD CONSTRAINT fk_${table}_organization FOREIGN KEY (organization_id) REFERENCES auth."organization" (id) ON DELETE RESTRICT`,
      );
      expect(statements).toContain(
        `CREATE INDEX idx_${table}_organization ON ${table} (organization_id)`,
      );
    });
  });

  it('handles the tables in the order agreements, workflows, onboardings', async () => {
    const statements = await runMigration('up');

    expect(indexOfStatement(statements, 'ALTER TABLE agreements ADD COLUMN')).toBeLessThan(
      indexOfStatement(statements, 'ALTER TABLE workflows ADD COLUMN'),
    );
    expect(indexOfStatement(statements, 'ALTER TABLE workflows ADD COLUMN')).toBeLessThan(
      indexOfStatement(statements, 'ALTER TABLE onboardings ADD COLUMN'),
    );
  });

  it('reverses the ownership and parentId in down, and never deletes an organization', async () => {
    const statements = await runMigration('down');

    for (const table of ['agreements', 'workflows', 'onboardings']) {
      expect(statements).toContain(`DROP INDEX IF EXISTS idx_${table}_organization`);
      expect(statements).toContain(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS fk_${table}_organization`,
      );
      expect(statements).toContain(`ALTER TABLE ${table} DROP COLUMN IF EXISTS organization_id`);
    }

    expect(statements).toContain(
      'ALTER TABLE auth."organization" DROP COLUMN IF EXISTS "parentId"',
    );
    expect(statements.some((statement) => /^(DELETE|TRUNCATE|DROP TABLE)/.test(statement))).toBe(
      false,
    );
    expect(statements.join(' ')).not.toMatch(/DELETE FROM auth\."organization"/);
  });
});
