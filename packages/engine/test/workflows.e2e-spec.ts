import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';

const VERSIONED_WORKFLOW_ID = 'workflow-store-e2e';

type StoredWorkflowVersionRow = {
  workflow_version_id: string;
  workflow_id: string;
  version: number;
  scope: string;
  definition: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

/**
 * `name` is the document's optional root label — the string the family's `workflows.name` takes
 * from its highest stored version — and changing it is also the smallest edit that produces a
 * `definition` differing from the one stored, which the immutability case below needs.
 */
const createWorkflowDefinition = (version: number, name: string) => ({
  id: VERSIONED_WORKFLOW_ID,
  version,
  name,
  initial: 'collect_email',
  steps: [
    {
      name: 'collect_email',
      type: 'form',
      config: {
        fields: { email: { type: 'text', required: true, validation: { format: 'email' } } },
      },
      edges: { success: 'approved' },
    },
    { name: 'approved', type: 'terminal', config: { outcome: 'approved' } },
  ],
});

describe('Workflow store (e2e)', () => {
  let app: NestExpressApplication | undefined;
  let dataSource: DataSource;
  let usersDir: string;

  const startApp = async (): Promise<void> => {
    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    await startE2eServer(app);
    dataSource = app.get(DataSource);
  };

  const stopApp = async (): Promise<void> => {
    await app?.close();
    app = undefined;
  };

  /**
   * After a boot that failed in `onModuleInit`: the application object exists and its database
   * connection is open, but it never finished initializing, so closing it may itself complain.
   */
  const discardFailedApp = async (): Promise<void> => {
    await app?.close().catch(() => undefined);
    app = undefined;
  };

  const findStoredLabel = async (): Promise<string | null> => {
    const [row] = await dataSource.query<{ name: string | null }[]>(
      'SELECT name FROM workflows WHERE key = $1',
      [VERSIONED_WORKFLOW_ID],
    );

    return row.name;
  };

  const findStoredRows = async (): Promise<StoredWorkflowVersionRow[]> =>
    dataSource.query(
      `SELECT wv.*
         FROM workflow_versions wv
         JOIN workflows w ON w.workflow_id = wv.workflow_id
        WHERE w.key = $1
        ORDER BY wv.version ASC`,
      [VERSIONED_WORKFLOW_ID],
    );

  const setStoredStatus = async (version: number, status: string): Promise<void> => {
    await dataSource.query(
      `UPDATE workflow_versions wv
          SET status = $1
         FROM workflows w
        WHERE w.workflow_id = wv.workflow_id AND w.key = $2 AND wv.version = $3`,
      [status, VERSIONED_WORKFLOW_ID, version],
    );
  };

  /**
   * Deletes every onboarding pointed at this workflow's versions before deleting the workflow
   * itself: `fk_onboardings_workflow_version` is `ON DELETE RESTRICT`, so a workflow with a
   * still-linked onboarding cannot be removed, cascade or not.
   */
  const purgeStoredWorkflow = async (): Promise<void> => {
    await dataSource.query(
      `DELETE FROM onboardings o
        USING workflow_versions wv, workflows w
        WHERE o.workflow_version_id = wv.workflow_version_id
          AND wv.workflow_id = w.workflow_id
          AND w.key = $1`,
      [VERSIONED_WORKFLOW_ID],
    );
    await dataSource.query('DELETE FROM workflows WHERE key = $1', [VERSIONED_WORKFLOW_ID]);
  };

  const writeUserWorkflow = (fileName: string, version: number, name: string): void => {
    writeFileSync(
      path.join(usersDir, fileName),
      JSON.stringify(createWorkflowDefinition(version, name)),
    );
  };

  beforeAll(async () => {
    usersDir = mkdtempSync(path.join(tmpdir(), 'engine-workflow-store-'));
    writeUserWorkflow('v1.workflow.json', 1, 'Workflow Store E2E v1');

    // Pinned because the CORS suites in this process set an origin of their own.
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    // Sibling suites in this process point this at a live server of their own, so it is reset
    // rather than inherited; everything else comes from .env.
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = usersDir;

    await startApp();
    await purgeStoredWorkflow();
    await stopApp();
    await startApp();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await purgeStoredWorkflow();
    }

    await stopApp();
    rmSync(usersDir, { recursive: true, force: true });
    delete process.env.WORKFLOWS_USERS_DIR;
  });

  it('stores the fixture workflows shipped with the repository', async () => {
    const rows = await dataSource.query(
      `SELECT w.key AS workflow_id, wv.scope
         FROM workflow_versions wv
         JOIN workflows w ON w.workflow_id = wv.workflow_id
        WHERE w.key = 'base'`,
    );

    expect(rows).toEqual([{ workflow_id: 'base', scope: 'fixtures' }]);
  });

  it('stores a discovered user workflow under the users scope', async () => {
    const rows = await findStoredRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1,
      scope: 'users',
    });
    expect(rows[0].definition).toEqual(createWorkflowDefinition(1, 'Workflow Store E2E v1'));
  });

  it('labels the workflow with the root name of the version it stored', async () => {
    expect(await findStoredLabel()).toBe('Workflow Store E2E v1');
  });

  it('starts an onboarding on the only stored version', async () => {
    const response = await request(app!.getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: VERSIONED_WORKFLOW_ID })
      .expect(201);

    const rows = await dataSource.query(
      `SELECT wv.version AS workflow_version
         FROM onboardings o
         JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
        WHERE o.id = $1`,
      [response.body.onboardingId],
    );

    expect(rows).toEqual([{ workflow_version: 1 }]);
  });

  it('leaves an unchanged revision untouched when startup runs again', async () => {
    const [before] = await findStoredRows();

    await stopApp();
    await startApp();

    const [after] = await findStoredRows();

    expect(after.updated_at).toEqual(before.updated_at);
    expect(await findStoredRows()).toHaveLength(1);
  });

  it('refuses to boot when a stored revision changed on disk, rather than rewriting it', async () => {
    const [before] = await findStoredRows();
    writeUserWorkflow('v1.workflow.json', 1, 'Workflow Store E2E revised');

    await stopApp();

    try {
      await expect(startApp()).rejects.toThrow(
        `Workflow "${VERSIONED_WORKFLOW_ID}" version 1 is already stored with a different definition`,
      );
    } finally {
      await discardFailedApp();
      writeUserWorkflow('v1.workflow.json', 1, 'Workflow Store E2E v1');
      await startApp();
    }

    const rows = await findStoredRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].definition).toEqual(createWorkflowDefinition(1, 'Workflow Store E2E v1'));
    expect(rows[0].updated_at).toEqual(before.updated_at);
    expect(await findStoredLabel()).toBe('Workflow Store E2E v1');
  });

  it('starts an onboarding on the highest stored version once a revision is published', async () => {
    writeUserWorkflow('v2.workflow.json', 2, 'Workflow Store E2E v2');

    await stopApp();
    await startApp();

    expect((await findStoredRows()).map((row) => row.version)).toEqual([1, 2]);

    const response = await request(app!.getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: VERSIONED_WORKFLOW_ID })
      .expect(201);

    const rows = await dataSource.query(
      `SELECT wv.version AS workflow_version
         FROM onboardings o
         JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
        WHERE o.id = $1`,
      [response.body.onboardingId],
    );

    expect(rows).toEqual([{ workflow_version: 2 }]);
  });

  it('moves the label to the newest published version', async () => {
    expect(await findStoredLabel()).toBe('Workflow Store E2E v2');
  });

  it('falls back to the previous published version as soon as the latest is drafted, without a restart', async () => {
    await setStoredStatus(2, 'draft');

    try {
      const response = await request(app!.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: VERSIONED_WORKFLOW_ID })
        .expect(201);

      const rows = await dataSource.query(
        `SELECT wv.version AS workflow_version
           FROM onboardings o
           JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
          WHERE o.id = $1`,
        [response.body.onboardingId],
      );

      expect(rows).toEqual([{ workflow_version: 1 }]);
    } finally {
      await setStoredStatus(2, 'published');
    }
  });

  it('refuses to start a retired revision as soon as it is retired, without a restart', async () => {
    await setStoredStatus(1, 'retired');
    await setStoredStatus(2, 'retired');

    try {
      await request(app!.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: VERSIONED_WORKFLOW_ID })
        .expect(404)
        .expect({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
    } finally {
      await setStoredStatus(1, 'published');
      await setStoredStatus(2, 'published');
    }
  });

  it('stops an onboarding already pinned to a revision once that revision is retired', async () => {
    const start = await request(app!.getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: VERSIONED_WORKFLOW_ID })
      .expect(201);
    const onboardingId = start.body.onboardingId as string;

    await request(app!.getHttpServer()).get(`/v1/onboardings/${onboardingId}/state`).expect(200);

    await setStoredStatus(2, 'retired');

    try {
      await request(app!.getHttpServer())
        .get(`/v1/onboardings/${onboardingId}/state`)
        .expect(410)
        .expect({ code: 'WORKFLOW_RETIRED', message: 'WORKFLOW_RETIRED' });

      await request(app!.getHttpServer())
        .post(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'person@example.com' })
        .expect(410)
        .expect({ code: 'WORKFLOW_RETIRED', message: 'WORKFLOW_RETIRED' });
    } finally {
      await setStoredStatus(2, 'published');
    }
  });

  it('serves the revision again once it is published back', async () => {
    const response = await request(app!.getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: VERSIONED_WORKFLOW_ID })
      .expect(201);

    const rows = await dataSource.query(
      `SELECT wv.version AS workflow_version
         FROM onboardings o
         JOIN workflow_versions wv ON wv.workflow_version_id = o.workflow_version_id
        WHERE o.id = $1`,
      [response.body.onboardingId],
    );

    expect(rows).toEqual([{ workflow_version: 2 }]);
  });
});
