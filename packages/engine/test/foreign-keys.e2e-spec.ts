import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';

/**
 * This spec is what makes "the entity relation decorator is the source of truth for the foreign
 * key" an enforced fact rather than a convention nobody checks. Migrations only ever project what
 * a relation decorator declares — they never state a foreign key independently — so this spec
 * walks `DataSource.entityMetadatas[].foreignKeys` and Postgres' `pg_constraint` catalog and
 * asserts the two describe exactly the same set of foreign keys, in both directions: every
 * declared relation has a matching constraint, and every constraint Postgres holds is declared by
 * some relation. A decorator and a migration's `ALTER TABLE` drifting apart fails this test.
 */

type ForeignKeyFingerprint = {
  name: string;
  table: string;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDeleteAction: string;
};

type PgForeignKeyRow = {
  name: string;
  table_name: string;
  referenced_table_name: string;
  on_delete_action: string;
  columns: string[];
  referenced_columns: string[];
};

describe('Entity metadata vs database foreign keys (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('matches every entity-declared foreign key against the database, in both directions', async () => {
    const dataSource = app?.get(DataSource) as DataSource;

    const declared: ForeignKeyFingerprint[] = dataSource.entityMetadatas.flatMap((entityMetadata) =>
      entityMetadata.foreignKeys.map((foreignKey) => ({
        name: foreignKey.name,
        table: foreignKey.entityMetadata.tableName,
        columns: [...foreignKey.columnNames].sort(),
        referencedTable: foreignKey.referencedEntityMetadata.tableName,
        referencedColumns: [...foreignKey.referencedColumnNames].sort(),
        onDeleteAction: foreignKey.onDelete ?? 'NO ACTION',
      })),
    );

    const rows = await dataSource.query<PgForeignKeyRow[]>(
      `SELECT
         con.conname AS name,
         rel.relname AS table_name,
         frel.relname AS referenced_table_name,
         CASE con.confdeltype
           WHEN 'c' THEN 'CASCADE'
           WHEN 'r' THEN 'RESTRICT'
           WHEN 'n' THEN 'SET NULL'
           WHEN 'd' THEN 'DEFAULT'
           ELSE 'NO ACTION'
         END AS on_delete_action,
         ARRAY(
           SELECT attname::text FROM pg_attribute
           WHERE attrelid = con.conrelid AND attnum = ANY(con.conkey)
           ORDER BY array_position(con.conkey, attnum)
         ) AS columns,
         ARRAY(
           SELECT attname::text FROM pg_attribute
           WHERE attrelid = con.confrelid AND attnum = ANY(con.confkey)
           ORDER BY array_position(con.confkey, attnum)
         ) AS referenced_columns
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_class frel ON frel.oid = con.confrelid
       JOIN pg_namespace ns ON ns.oid = rel.relnamespace
       WHERE con.contype = 'f' AND ns.nspname = 'public'
       ORDER BY con.conname`,
    );

    const actual: ForeignKeyFingerprint[] = rows.map((row) => ({
      name: row.name,
      table: row.table_name,
      columns: [...row.columns].sort(),
      referencedTable: row.referenced_table_name,
      referencedColumns: [...row.referenced_columns].sort(),
      onDeleteAction: row.on_delete_action,
    }));

    // Keyed by table and name, not name alone: Postgres scopes a constraint name to its table,
    // so two tables may legitimately carry same-named foreign keys and keying on the bare name
    // would silently collapse them to one entry per side.
    const byKey = (fingerprints: ForeignKeyFingerprint[]) =>
      new Map(
        fingerprints.map((fingerprint) => [
          `${fingerprint.table}.${fingerprint.name}`,
          fingerprint,
        ]),
      );

    const declaredByKey = byKey(declared);
    const actualByKey = byKey(actual);

    // Guards against a passing-by-vacuity test: if metadata build ever stopped registering
    // foreign keys, both sides would be empty and every assertion below would trivially pass.
    expect(declared.length).toBeGreaterThan(0);

    expect([...declaredByKey.keys()].sort()).toEqual([...actualByKey.keys()].sort());

    for (const [key, expectedFingerprint] of declaredByKey) {
      expect(actualByKey.get(key)).toEqual(expectedFingerprint);
    }
  });
});
