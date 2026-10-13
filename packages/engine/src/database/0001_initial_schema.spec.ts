import { InitialSchema0001 } from './migrations/0001_initial_schema';

// Sits beside the migrations directory rather than in it: the migrations glob loads every file
// there as a migration, and a spec is not one.

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

/** Runs `up` or `down`, recording every statement issued, each normalized to single-line SQL. */
const runMigration = async (direction: 'up' | 'down'): Promise<string[]> => {
  const query = jest.fn<Promise<unknown>, [string]>(async () => undefined);

  await new InitialSchema0001()[direction]({ query } as never);

  return query.mock.calls.map(([sql]) => normalize(sql));
};

const findStatement = (statements: string[], prefix: string): string => {
  const statement = statements.find((candidate) => candidate.startsWith(prefix));

  expect(statement).toBeDefined();

  return statement as string;
};

describe('0001_initial_schema', () => {
  it('is named for TypeORM to run it in sequence', () => {
    expect(InitialSchema0001.name).toBe('InitialSchema0001');
    expect(new InitialSchema0001().name).toMatch(/^0001_initial_schema_\d{13}$/);
  });

  it('creates every table without a foreign key, then adds each constraint on its own', async () => {
    const statements = await runMigration('up');
    const createTables = statements.filter((statement) => statement.startsWith('CREATE TABLE'));
    const foreignKeys = statements.filter((statement) => statement.includes('FOREIGN KEY'));

    expect(createTables).toHaveLength(13);

    for (const createTable of createTables) {
      expect(createTable).not.toContain('FOREIGN KEY');
    }

    expect(foreignKeys).toHaveLength(9);

    for (const foreignKey of foreignKeys) {
      expect(foreignKey).toMatch(/^-- Mirrors \w+\.\w+ ALTER TABLE \w+ ADD CONSTRAINT fk_\w+ /);
      expect(statements.indexOf(foreignKey)).toBeGreaterThan(
        statements.indexOf(createTables[createTables.length - 1]),
      );
    }

    expect(foreignKeys).toContainEqual(
      expect.stringContaining(
        'ADD CONSTRAINT fk_workflow_connector_selections_workflow FOREIGN KEY (workflow_id) REFERENCES workflows (workflow_id) ON DELETE CASCADE',
      ),
    );
  });

  it('carries the parked connector on onboardings as a nullable jsonb object', async () => {
    const onboardings = findStatement(await runMigration('up'), 'CREATE TABLE onboardings ');

    expect(onboardings).toContain('pending_connector JSONB NULL');
    expect(onboardings).toContain(
      "CONSTRAINT chk_onboardings_pending_connector_object CHECK (pending_connector IS NULL OR jsonb_typeof(pending_connector) = 'object')",
    );
  });

  it('indexes onboardings for the encryption sweep, the in-progress count and the keyset order', async () => {
    const statements = await runMigration('up');

    expect(statements).toContain(
      "CREATE INDEX idx_onboardings_encryption_key ON onboardings ((context ->> 'k')) WHERE context ? '__tsh_enc'",
    );
    expect(statements).toContain(
      "CREATE INDEX idx_onboardings_plaintext_context ON onboardings (id) WHERE NOT (context ? '__tsh_enc')",
    );
    expect(statements).toContain(
      'CREATE INDEX idx_onboardings_in_progress_version ON onboardings (workflow_version_id) WHERE completed_at IS NULL',
    );
    expect(statements).toContain(
      'CREATE INDEX idx_onboardings_created_at_id ON onboardings (created_at DESC, id DESC)',
    );
  });

  it('allows a workflow family one draft at most', async () => {
    expect(await runMigration('up')).toContain(
      "CREATE UNIQUE INDEX uq_workflow_versions_one_draft ON workflow_versions (workflow_id) WHERE status = 'draft'",
    );
  });

  it('creates the connector selections keyed by family, version and step', async () => {
    const selections = findStatement(
      await runMigration('up'),
      'CREATE TABLE workflow_connector_selections',
    );

    expect(selections).toContain('workflow_id UUID NOT NULL');
    expect(selections).toContain('step_name VARCHAR(100) NOT NULL');
    expect(selections).toContain('connector_id VARCHAR(64) NOT NULL');
    expect(selections).toContain('updated_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(selections).toContain('updated_by VARCHAR(255) NULL');
    expect(selections).toContain('version INTEGER NOT NULL');
    expect(selections).toContain(
      'CONSTRAINT pk_workflow_connector_selections PRIMARY KEY (workflow_id, version, step_name)',
    );
    expect(selections).toContain(
      'CONSTRAINT chk_workflow_connector_selections_version_positive CHECK (version > 0)',
    );
    expect(selections).toContain("CHECK (btrim(step_name) <> '')");
    expect(selections).toContain("CHECK (connector_id ~ '^[a-z0-9_]+$')");
  });

  it('creates the encryption key history with its schedule and re-encryption columns', async () => {
    const encryptionKeys = findStatement(await runMigration('up'), 'CREATE TABLE encryption_keys');

    expect(encryptionKeys).toContain('id UUID NOT NULL');
    expect(encryptionKeys).toContain('wrapped_key TEXT NOT NULL');
    expect(encryptionKeys).toContain('created_at TIMESTAMPTZ NOT NULL DEFAULT now()');
    expect(encryptionKeys).toContain('created_by VARCHAR(255) NULL');
    expect(encryptionKeys).toContain('activated_at TIMESTAMPTZ NOT NULL');
    expect(encryptionKeys).toContain('deleted_at TIMESTAMPTZ NULL');
    // Nullable on purpose: `NULL` is "no automatic rotation" and "no re-encryption outstanding".
    expect(encryptionKeys).toContain('rotation_interval VARCHAR(8) NULL');
    expect(encryptionKeys).toContain('reencrypt_requested_at TIMESTAMPTZ NULL');
    expect(encryptionKeys).toContain('CONSTRAINT pk_encryption_keys PRIMARY KEY (id)');
  });

  describe('uq_encryption_keys_active', () => {
    const findActiveIndex = async (): Promise<string> =>
      findStatement(await runMigration('up'), 'CREATE UNIQUE INDEX uq_encryption_keys_active');

    it('is the exact partial unique index over the active row', async () => {
      expect(await findActiveIndex()).toBe(
        'CREATE UNIQUE INDEX uq_encryption_keys_active ON encryption_keys ((deleted_at IS NULL)) WHERE deleted_at IS NULL',
      );
    });

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
      const activeIndexSql = await findActiveIndex();

      expect(indexKeyFor(new Date(), activeIndexSql)).toBeUndefined();
      expect(indexKeyFor(new Date('2020-01-01'), activeIndexSql)).toBeUndefined();
    });

    it('gives every included row the identical key, so a second one collides on the unique index', async () => {
      const activeIndexSql = await findActiveIndex();

      const first = indexKeyFor(null, activeIndexSql);
      const second = indexKeyFor(null, activeIndexSql);

      expect(first).toBe(true);
      expect(second).toBe(true);
      // A real UNIQUE INDEX rejects a second row whose key equals an existing one — since both
      // rows here key to the same value, at most one of them could ever be inserted.
      expect(first).toBe(second);
    });
  });

  it('drops the view, every table it created and the outbox trigger function', async () => {
    const statements = await runMigration('down');

    expect(statements).toEqual([
      'DROP VIEW IF EXISTS onboarding_agreement_statuses',
      'DROP TABLE IF EXISTS encryption_keys, onboarding_agreements, agreement_versions, agreements, connectors, workflow_connector_selections, workflow_versions, workflows, audit_log, client_webhook_outbox, onboarding_documents, onboardings, _engine_alive',
      'DROP FUNCTION IF EXISTS set_client_webhook_outbox_next_delivery_at()',
    ]);

    const createdTables = (await runMigration('up'))
      .filter((statement) => statement.startsWith('CREATE TABLE'))
      .map((statement) => statement.split(' ')[2]);

    expect(new Set(statements[1].replace('DROP TABLE IF EXISTS ', '').split(', '))).toEqual(
      new Set(createdTables),
    );
  });
});
