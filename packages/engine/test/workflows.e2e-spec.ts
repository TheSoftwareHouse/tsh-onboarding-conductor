import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

const VERSIONED_WORKFLOW_ID = 'workflow-store-e2e';

type StoredWorkflowRow = {
  workflow_id: string;
  version: number;
  scope: string;
  definition: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

const createWorkflowDefinition = (version: number, name: string) => ({
  id: VERSIONED_WORKFLOW_ID,
  version,
  name,
  initial: 'collect_email',
  steps: [
    {
      name: 'collect_email',
      status: 'awaiting_user',
      data: {
        email: { type: 'text', required: true, validation: { format: 'email' } },
      },
      transitions: [{ status: 'success', target: 'approved' }],
    },
    { name: 'approved', status: 'approved', data: {}, transitions: [] },
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
    await app.init();
    dataSource = app.get(DataSource);
  };

  const stopApp = async (): Promise<void> => {
    await app?.close();
    app = undefined;
  };

  const findStoredRows = async (): Promise<StoredWorkflowRow[]> =>
    dataSource.query('SELECT * FROM workflows WHERE workflow_id = $1 ORDER BY version ASC', [
      VERSIONED_WORKFLOW_ID,
    ]);

  const setStoredStatus = async (version: number, status: string): Promise<void> => {
    await dataSource.query(
      'UPDATE workflows SET status = $1 WHERE workflow_id = $2 AND version = $3',
      [status, VERSIONED_WORKFLOW_ID, version],
    );
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
    await dataSource.query('DELETE FROM workflows WHERE workflow_id = $1', [VERSIONED_WORKFLOW_ID]);
    await stopApp();
    await startApp();
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await dataSource.query('DELETE FROM workflows WHERE workflow_id = $1', [
        VERSIONED_WORKFLOW_ID,
      ]);
    }

    await stopApp();
    rmSync(usersDir, { recursive: true, force: true });
    delete process.env.WORKFLOWS_USERS_DIR;
  });

  it('stores the fixture workflows shipped with the repository', async () => {
    const rows = await dataSource.query(
      "SELECT workflow_id, scope FROM workflows WHERE workflow_id = 'base'",
    );

    expect(rows).toEqual([{ workflow_id: 'base', scope: 'fixtures' }]);
  });

  it('stores a discovered user workflow under the users scope', async () => {
    const rows = await findStoredRows();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      workflow_id: VERSIONED_WORKFLOW_ID,
      version: 1,
      scope: 'users',
    });
    expect(rows[0].definition).toEqual(createWorkflowDefinition(1, 'Workflow Store E2E v1'));
  });

  it('starts an onboarding on the only stored version', async () => {
    const response = await request(app!.getHttpServer())
      .post('/v1/onboardings')
      .send({ workflowId: VERSIONED_WORKFLOW_ID })
      .expect(201);

    const rows = await dataSource.query('SELECT workflow_version FROM onboardings WHERE id = $1', [
      response.body.onboardingId,
    ]);

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

  it('updates a revision in place when its definition changed on disk', async () => {
    const [before] = await findStoredRows();
    writeUserWorkflow('v1.workflow.json', 1, 'Workflow Store E2E revised');

    await stopApp();
    await startApp();

    const rows = await findStoredRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].definition).toEqual(createWorkflowDefinition(1, 'Workflow Store E2E revised'));
    expect(rows[0].updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
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

    const rows = await dataSource.query('SELECT workflow_version FROM onboardings WHERE id = $1', [
      response.body.onboardingId,
    ]);

    expect(rows).toEqual([{ workflow_version: 2 }]);
  });

  it('falls back to the previous published version as soon as the latest is drafted, without a restart', async () => {
    await setStoredStatus(2, 'draft');

    try {
      const response = await request(app!.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: VERSIONED_WORKFLOW_ID })
        .expect(201);

      const rows = await dataSource.query(
        'SELECT workflow_version FROM onboardings WHERE id = $1',
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

    const rows = await dataSource.query('SELECT workflow_version FROM onboardings WHERE id = $1', [
      response.body.onboardingId,
    ]);

    expect(rows).toEqual([{ workflow_version: 2 }]);
  });
});
