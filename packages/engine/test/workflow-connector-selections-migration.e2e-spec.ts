import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { DataSource, QueryRunner } from 'typeorm';
import { ScopeWorkflowConnectorSelectionsPerVersion0032 } from '../src/database/migrations/0032_scope_workflow_connector_selections_per_version';
import {
  DRAFT_WORKFLOW_STATUS,
  PUBLISHED_WORKFLOW_STATUS,
  RETIRED_WORKFLOW_STATUS,
} from '../src/workflows/workflow-status';
import { startE2eServer } from './e2e-server';

const WORKFLOW_ID = '00000000-0000-4000-8000-0000000032aa';
const OPERATOR = 'operator-0032';

describe('Migration 0032 on existing workflow connector selections (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    process.env.ADMIN_AUTH_ENABLED = 'false';

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  const seedFamily = async (queryRunner: QueryRunner): Promise<void> => {
    await queryRunner.query(
      `INSERT INTO workflows (workflow_id, key, name, scope) VALUES ($1, 'migration-0032-e2e', NULL, 'users')`,
      [WORKFLOW_ID],
    );

    const versions: [number, string, string[]][] = [
      [1, PUBLISHED_WORKFLOW_STATUS, ['kyc']],
      [2, PUBLISHED_WORKFLOW_STATUS, ['kyc']],
      // An `otp-verify` step named `phone` compiles to `phone_verify`, which the document never lists.
      [3, PUBLISHED_WORKFLOW_STATUS, ['phone']],
      [4, DRAFT_WORKFLOW_STATUS, ['kyc']],
      [5, RETIRED_WORKFLOW_STATUS, ['kyc']],
    ];

    for (const [version, status, stepNames] of versions) {
      await queryRunner.query(
        `INSERT INTO workflow_versions (workflow_version_id, workflow_id, version, status, definition)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::json)`,
        [
          WORKFLOW_ID,
          version,
          status,
          JSON.stringify({ steps: stepNames.map((name) => ({ name })) }),
        ],
      );
    }

    await queryRunner.query(
      `INSERT INTO workflow_connector_selections (workflow_id, step_name, connector_id, updated_by)
       VALUES ($1, 'kyc', 'mock_kyc_2', $2), ($1, 'phone_verify', 'mock_sms_2', $2)`,
      [WORKFLOW_ID, OPERATOR],
    );
  };

  it('copies a family-wide row to each published version, compiled sub-steps included, and collapses back', async () => {
    const dataSource = app?.get(DataSource) as DataSource;
    const queryRunner = dataSource.createQueryRunner();
    const migration = new ScopeWorkflowConnectorSelectionsPerVersion0032();

    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      await migration.down(queryRunner);
      await seedFamily(queryRunner);

      await migration.up(queryRunner);

      const rows = await queryRunner.query(
        `SELECT version, step_name, connector_id, updated_by FROM workflow_connector_selections
         WHERE workflow_id = $1 ORDER BY version, step_name`,
        [WORKFLOW_ID],
      );
      expect(rows).toEqual(
        [1, 2, 3].flatMap((version) => [
          { version, step_name: 'kyc', connector_id: 'mock_kyc_2', updated_by: OPERATOR },
          { version, step_name: 'phone_verify', connector_id: 'mock_sms_2', updated_by: OPERATOR },
        ]),
      );

      const nullVersions = await queryRunner.query(
        'SELECT count(*)::int AS count FROM workflow_connector_selections WHERE version IS NULL',
      );
      expect(nullVersions).toEqual([{ count: 0 }]);

      await queryRunner.query(
        `UPDATE workflow_connector_selections SET connector_id = 'mock_kyc'
         WHERE workflow_id = $1 AND version = 3 AND step_name = 'kyc'`,
        [WORKFLOW_ID],
      );
      await migration.down(queryRunner);

      const collapsed = await queryRunner.query(
        `SELECT step_name, connector_id FROM workflow_connector_selections WHERE workflow_id = $1
         ORDER BY step_name`,
        [WORKFLOW_ID],
      );
      expect(collapsed).toEqual([
        { step_name: 'kyc', connector_id: 'mock_kyc' },
        { step_name: 'phone_verify', connector_id: 'mock_sms_2' },
      ]);

      const primaryKey = await queryRunner.query(
        `SELECT a.attname AS column_name
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = 'workflow_connector_selections'::regclass AND i.indisprimary
         ORDER BY a.attname`,
      );
      expect(primaryKey).toEqual([{ column_name: 'step_name' }, { column_name: 'workflow_id' }]);
    } finally {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }
      await queryRunner.release();
    }

    const leftovers = await dataSource.query('SELECT 1 FROM workflows WHERE workflow_id = $1', [
      WORKFLOW_ID,
    ]);
    expect(leftovers).toEqual([]);
  });
});
