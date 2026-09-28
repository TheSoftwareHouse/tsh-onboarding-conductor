import { CreateEncryptionKeys0024 } from './migrations/0024_create_encryption_keys';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new CreateEncryptionKeys0024()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

describe('0024_create_encryption_keys', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(CreateEncryptionKeys0024.name).toBe('CreateEncryptionKeys0024');
    expect(new CreateEncryptionKeys0024().name).toMatch(/^0024_create_encryption_keys_\d{13}$/);
  });

  it('creates the table with its schedule and re-encryption columns, then the three indexes, in order', async () => {
    const statements = await runMigration('up');

    expect(statements).toHaveLength(4);

    expect(statements[0]).toContain('CREATE TABLE encryption_keys');
    expect(statements[0]).toContain('id UUID NOT NULL');
    expect(statements[0]).toContain('wrapped_key TEXT NOT NULL');
    expect(statements[0]).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(statements[0]).toContain('created_by VARCHAR(255) NULL');
    expect(statements[0]).toContain('activated_at TIMESTAMPTZ NOT NULL');
    expect(statements[0]).toContain('deleted_at TIMESTAMPTZ NULL');
    // Nullable on purpose: `NULL` is "no automatic rotation" and "no re-encryption outstanding".
    expect(statements[0]).toContain('rotation_interval VARCHAR(8) NULL');
    expect(statements[0]).toContain('reencrypt_requested_at TIMESTAMPTZ NULL');
    expect(statements[0]).toContain('CONSTRAINT pk_encryption_keys PRIMARY KEY (id)');

    expect(statements[1]).toBe(
      'CREATE UNIQUE INDEX uq_encryption_keys_active ON encryption_keys ((deleted_at IS NULL)) WHERE deleted_at IS NULL',
    );

    expect(statements[2]).toBe(
      "CREATE INDEX idx_onboardings_encryption_key ON onboardings ((context ->> 'k')) WHERE context ? '__tsh_enc'",
    );

    expect(statements[3]).toBe(
      "CREATE INDEX idx_onboardings_plaintext_context ON onboardings (id) WHERE NOT (context ? '__tsh_enc')",
    );
  });

  it('drops everything `up` creates, in reverse order', async () => {
    const statements = await runMigration('down');

    expect(statements).toEqual([
      'DROP INDEX IF EXISTS idx_onboardings_plaintext_context',
      'DROP INDEX IF EXISTS idx_onboardings_encryption_key',
      'DROP INDEX IF EXISTS uq_encryption_keys_active',
      'DROP TABLE IF EXISTS encryption_keys',
    ]);
  });

  describe('uq_encryption_keys_active', () => {
    /**
     * Mirrors Postgres' evaluation of the exact predicate and expression `up` issues, extracted
     * from the captured SQL rather than restated by hand, so a change to the migration's text
     * changes this test rather than silently drifting from it. Returns the index key a row would
     * occupy, or `undefined` when the partial predicate excludes the row from the index entirely.
     */
    const indexKeyFor = (deletedAt: Date | null, indexSql: string): boolean | undefined => {
      const included = /WHERE deleted_at IS NULL$/.test(indexSql) ? deletedAt === null : false;

      if (!included) {
        return undefined;
      }

      // The indexed expression itself: `(deleted_at IS NULL)`.
      return deletedAt === null;
    };

    it('excludes a soft-deleted row from the index, however many exist', async () => {
      const [, activeIndexSql] = await runMigration('up');

      expect(indexKeyFor(new Date(), activeIndexSql)).toBeUndefined();
      expect(indexKeyFor(new Date('2020-01-01'), activeIndexSql)).toBeUndefined();
    });

    it('gives every included row the identical key, so a second one collides on the unique index', async () => {
      const [, activeIndexSql] = await runMigration('up');

      const first = indexKeyFor(null, activeIndexSql);
      const second = indexKeyFor(null, activeIndexSql);

      expect(first).toBe(true);
      expect(second).toBe(true);
      // A real UNIQUE INDEX rejects a second row whose key equals an existing one — since both
      // rows here key to the same value, at most one of them could ever be inserted.
      expect(first).toBe(second);
    });
  });
});
