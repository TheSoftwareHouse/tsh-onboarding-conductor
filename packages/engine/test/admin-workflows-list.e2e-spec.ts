import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { startE2eServer } from './e2e-server';

const PREFIX = 'admin-workflows-e2e';

const createWorkflowDefinition = (id: string, version: number, name?: string) => ({
  id,
  version,
  ...(name === undefined ? {} : { name }),
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

describe('Admin workflows list (e2e)', () => {
  let app: NestExpressApplication;
  let dataSource: DataSource;
  let usersDir: string;

  const writeWorkflow = (id: string, version: number, name?: string): void => {
    writeFileSync(
      path.join(usersDir, `${id}-${version}.workflow.json`),
      JSON.stringify(createWorkflowDefinition(id, version, name)),
    );
  };

  const setStoredStatus = async (
    workflowId: string,
    version: number,
    status: string,
  ): Promise<void> => {
    await dataSource.query(
      `UPDATE workflow_versions wv
          SET status = $1
         FROM workflows w
        WHERE w.workflow_id = wv.workflow_id AND w.key = $2 AND wv.version = $3`,
      [status, workflowId, version],
    );
  };

  const purgeSeededWorkflows = async (): Promise<void> => {
    await dataSource.query(
      `DELETE FROM onboardings o
        USING workflow_versions wv, workflows w
        WHERE o.workflow_version_id = wv.workflow_version_id
          AND wv.workflow_id = w.workflow_id
          AND w.key LIKE $1`,
      [`${PREFIX}%`],
    );
    await dataSource.query('DELETE FROM workflows WHERE key LIKE $1', [`${PREFIX}%`]);
  };

  beforeAll(async () => {
    usersDir = mkdtempSync(path.join(tmpdir(), 'engine-admin-workflows-list-'));

    writeWorkflow(`${PREFIX}-alpha`, 1);
    writeWorkflow(`${PREFIX}-gamma`, 1, 'Admin Workflows E2E NameOnlyZulu');
    writeWorkflow(`${PREFIX}-percent-match`, 1, 'Admin Workflows E2E 100% Match');
    writeWorkflow(`${PREFIX}-percent-decoy`, 1, 'Admin Workflows E2E 100X Decoy');
    writeWorkflow(`${PREFIX}-draft-only`, 1);
    writeWorkflow(`${PREFIX}-inprogress`, 1);
    writeWorkflow(`${PREFIX}-multi-version`, 1);
    writeWorkflow(`${PREFIX}-multi-version`, 2);
    writeWorkflow(`${PREFIX}-page-a`, 1);
    writeWorkflow(`${PREFIX}-page-b`, 1);
    writeWorkflow(`${PREFIX}-page-c`, 1);

    process.env.ADMIN_AUTH_ENABLED = 'false';
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
    process.env.CLIENT_WEBHOOK_BASE_URL = '';
    process.env.WORKFLOWS_USERS_DIR = usersDir;

    const { AppModule } = await import('../src/app.module');
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await startE2eServer(app);
    dataSource = app.get(DataSource);

    await setStoredStatus(`${PREFIX}-draft-only`, 1, 'draft');

    const startInProgressOnboarding = () =>
      request(app.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: `${PREFIX}-inprogress` })
        .expect(201);

    await startInProgressOnboarding();
    const completed = await startInProgressOnboarding();

    await dataSource.query(
      `UPDATE onboardings
          SET status = 'approved', current_step = NULL, completed_at = now()
        WHERE id = $1`,
      [completed.body.onboardingId],
    );

    // Regression coverage: the onboardings join must not inflate versionCount/draftCount when a version carries more than one onboarding.
    const startMultiVersionOnboarding = () =>
      request(app.getHttpServer())
        .post('/v1/onboardings')
        .send({ workflowId: `${PREFIX}-multi-version` })
        .expect(201);

    await startMultiVersionOnboarding();
    const completedMultiVersion = await startMultiVersionOnboarding();

    await dataSource.query(
      `UPDATE onboardings
          SET status = 'approved', current_step = NULL, completed_at = now()
        WHERE id = $1`,
      [completedMultiVersion.body.onboardingId],
    );

    await setStoredStatus(`${PREFIX}-multi-version`, 2, 'draft');
  });

  afterAll(async () => {
    if (dataSource?.isInitialized) {
      await purgeSeededWorkflows();
    }

    await app?.close();
    rmSync(usersDir, { recursive: true, force: true });
    delete process.env.WORKFLOWS_USERS_DIR;
  });

  it('returns the envelope with the default page window', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: PREFIX })
      .expect(200);

    expect(response.body.meta.pagination).toEqual({ page: 1, limit: 20, total: 10, totalPages: 1 });
    expect(response.body.items).toHaveLength(10);
    expect(response.body.items[0]).toEqual(
      expect.objectContaining({
        workflowId: expect.any(String),
        scope: 'users',
        versionCount: expect.any(Number),
        draftCount: expect.any(Number),
        inProgressCount: expect.any(Number),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      }),
    );
    expect(response.body.items.some((item: { name: unknown }) => 'definition' in item)).toBe(false);
  });

  it('searches by key', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-alpha` })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ workflowId: `${PREFIX}-alpha` }),
    ]);
  });

  it('searches by name', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: 'NameOnlyZulu' })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ workflowId: `${PREFIX}-gamma` }),
    ]);
  });

  it('treats a literal % in the search text as text, not a wildcard', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: '100%' })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ workflowId: `${PREFIX}-percent-match` }),
    ]);
  });

  it('filters by scope', async () => {
    const usersScope = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: PREFIX, scope: 'users' })
      .expect(200);
    expect(usersScope.body.meta.pagination.total).toBe(10);

    const builtInScope = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: PREFIX, scope: 'built-in' })
      .expect(200);
    expect(builtInScope.body.items).toEqual([]);
  });

  it('narrows to workflows holding a draft version when hasDraft=true', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: PREFIX, hasDraft: 'true' })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({
        workflowId: `${PREFIX}-draft-only`,
        servingVersion: null,
        draftCount: 1,
      }),
      expect.objectContaining({
        workflowId: `${PREFIX}-multi-version`,
        servingVersion: 1,
        draftCount: 1,
      }),
    ]);
  });

  it('reports a null serving version when no version is published', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-draft-only` })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({ servingVersion: null, versionCount: 1, draftCount: 1 }),
    ]);
  });

  it('counts only onboardings that have not completed', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-inprogress` })
      .expect(200);

    expect(response.body.items).toEqual([expect.objectContaining({ inProgressCount: 1 })]);
  });

  it('does not inflate versionCount or draftCount when a version carries more than one onboarding', async () => {
    const response = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-multi-version` })
      .expect(200);

    expect(response.body.items).toEqual([
      expect.objectContaining({
        workflowId: `${PREFIX}-multi-version`,
        servingVersion: 1,
        versionCount: 2,
        draftCount: 1,
        inProgressCount: 1,
      }),
    ]);
  });

  it('pages the results, ordered by key ascending', async () => {
    const first = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-page`, limit: 1, page: 1 })
      .expect(200);
    expect(first.body.items).toEqual([expect.objectContaining({ workflowId: `${PREFIX}-page-a` })]);
    expect(first.body.meta.pagination).toEqual({ page: 1, limit: 1, total: 3, totalPages: 3 });

    const second = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-page`, limit: 1, page: 2 })
      .expect(200);
    expect(second.body.items).toEqual([
      expect.objectContaining({ workflowId: `${PREFIX}-page-b` }),
    ]);

    const third = await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ search: `${PREFIX}-page`, limit: 1, page: 3 })
      .expect(200);
    expect(third.body.items).toEqual([expect.objectContaining({ workflowId: `${PREFIX}-page-c` })]);
  });

  it('rejects an unknown scope', async () => {
    await request(app.getHttpServer())
      .get('/v1/admin/workflows')
      .query({ scope: 'nope' })
      .expect(400);
  });

  it('rejects a limit above the shared maximum', async () => {
    await request(app.getHttpServer()).get('/v1/admin/workflows').query({ limit: 101 }).expect(400);
  });
});
