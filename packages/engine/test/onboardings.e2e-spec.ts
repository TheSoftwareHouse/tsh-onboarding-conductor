import path from 'node:path';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { TshKyc1Connector } from '../src/connectors/adapters/tsh-kyc.connector';
import { TshKyc2Connector } from '../src/connectors/adapters/tsh-kyc-2.connector';
import { OnboardingsRepository } from '../src/onboardings/onboardings.repository';
import { OnboardingsService } from '../src/onboardings/onboardings.service';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';

const ENGINE_SERVICE_SECRET = 'integration-secret';

const VALID_CONTACT_SUBMIT = {
  email: 'person@example.com',
  phone: '+48123456789',
  acceptedTerms: true,
  privacyAcknowledged: true,
};

jest.setTimeout(30000);

describe('OnboardingsController (e2e)', () => {
  let app: NestExpressApplication | null = null;
  const createdOnboardingIds = new Set<string>();

  const getApp = (): NestExpressApplication => {
    if (!app) {
      throw new Error('Test app not initialized');
    }

    return app;
  };

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.MODE = 'api-only';
    process.env.PORT = '3000';
    process.env.DATABASE_URL =
      'postgres://orchestrator:orchestrator_pass@127.0.0.1:5432/orchestrator?sslmode=disable';
    process.env.REDIS_URL = 'redis://127.0.0.1:6379/0';
    process.env.STORAGE_DRIVER = 's3';
    process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
    process.env.STORAGE_S3_REGION = 'us-east-1';
    process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
    process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
    process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
    process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
    process.env.WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', 'workflows');
    process.env.ENGINE_SERVICE_SECRET = ENGINE_SERVICE_SECRET;
    process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5174';

    const { AppModule } = await import('../src/app.module');

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>({
      bodyParser: false,
    });
    app.useBodyParser('json', { strict: false });
    app.useBodyParser('urlencoded', { extended: true });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  const http = () => request(getApp().getHttpServer());

  const guardedPost = (path: string) =>
    http().post(path).set('x-engine-service-secret', ENGINE_SERVICE_SECRET);

  const guardedGet = (path: string) =>
    http().get(path).set('x-engine-service-secret', ENGINE_SERVICE_SECRET);

  const getSeededAdminOnboardingSummaries = (
    responseBody: Array<Record<string, unknown>>,
    seededIds: string[],
  ) =>
    responseBody.filter((item: Record<string, unknown>) =>
      seededIds.includes(item.onboardingId as string),
    );

  const expectSeededAdminOnboardingSummaries = (
    responseBody: Array<Record<string, unknown>>,
    seededIds: string[],
    expectedSummaries: Array<Record<string, unknown>>,
  ) => {
    const seededResponses = getSeededAdminOnboardingSummaries(responseBody, seededIds);

    expect(seededResponses).toEqual(expectedSummaries);
    expect(seededResponses.every((item: Record<string, unknown>) => !('context' in item))).toBe(
      true,
    );
  };

  const getAdminOnboardings = (query?: string | Record<string, string | string[]>) => {
    const requestBuilder = http().get('/v1/admin/onboardings');

    if (query === undefined) {
      return requestBuilder;
    }

    if (typeof query === 'string') {
      return http().get(`/v1/admin/onboardings${query}`);
    }

    return requestBuilder.query(query);
  };

  const snapshotExistingOnboardingIds = async (): Promise<string[]> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const existingRows = (await dataSource.query('SELECT id FROM onboardings')) as Array<{
      id: string;
    }>;

    return existingRows.map(({ id }) => id).sort();
  };

  const createUniqueOnboardingId = async (): Promise<string> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const existingRows = (await dataSource.query('SELECT id FROM onboardings')) as Array<{
      id: string;
    }>;
    const existingIds = new Set<string>(existingRows.map(({ id }) => id));

    const MAX_CANDIDATE_INDEX = 9999;

    for (let candidateIndex = 1; candidateIndex <= MAX_CANDIDATE_INDEX; candidateIndex += 1) {
      const candidateId = `00000000-0000-4000-8000-${String(candidateIndex).padStart(12, '0')}`;
      if (!existingIds.has(candidateId) && !createdOnboardingIds.has(candidateId)) {
        return candidateId;
      }
    }

    throw new Error('Unable to generate a unique onboarding test id: candidate space exhausted');
  };

  const seedAdminOnboardingsFixtures = async (
    fixtures: Array<{
      id?: string;
      workflowId: string;
      workflowVersion: number;
      status: 'awaiting_user' | 'approved';
      currentStep: string | null;
      context: Record<string, unknown>;
      createdAt: string;
      updatedAt: string;
      completedAt: string | null;
      expiresAt: string | null;
    }>,
  ): Promise<string[]> => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const seededIds: string[] = [];

    for (const fixture of fixtures) {
      const onboardingId = fixture.id ?? (await createUniqueOnboardingId());
      await dataSource.query(
        `INSERT INTO onboardings (
          id,
          workflow_id,
          workflow_version,
          status,
          current_step,
          context,
          expires_at,
          created_at,
          updated_at,
          completed_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10)`,
        [
          onboardingId,
          fixture.workflowId,
          fixture.workflowVersion,
          fixture.status,
          fixture.currentStep,
          JSON.stringify(fixture.context),
          fixture.expiresAt,
          fixture.createdAt,
          fixture.updatedAt,
          fixture.completedAt,
        ],
      );
      createdOnboardingIds.add(onboardingId);
      seededIds.push(onboardingId);
    }

    return seededIds;
  };

  const cleanupAdminOnboardingsFixtures = async (ids: string[]) => {
    if (ids.length === 0) {
      return;
    }

    await getApp()
      .get(DataSource)
      .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [ids]);

    ids.forEach((id) => createdOnboardingIds.delete(id));
  };

  const startOnboarding = async () => {
    const response = await guardedPost('/v1/onboardings').send({ workflowId: 'base' }).expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'collect_contact',
      expiresAt: null,
    });

    expect(response.body.onboardingId).not.toHaveLength(0);

    expect(await readOnboarding(response.body.onboardingId)).toEqual(
      expect.objectContaining({
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'collect_contact',
        context: {},
        completed_at: null,
      }),
    );

    const onboardingId = response.body.onboardingId as string;
    createdOnboardingIds.add(onboardingId);
    return onboardingId;
  };

  const readOnboarding = async (id: string) => {
    const rows = await getApp()
      .get(DataSource)
      .query(
        `SELECT workflow_id, workflow_version, status, current_step, context, completed_at
       FROM onboardings
       WHERE id = $1`,
        [id],
      );

    return rows[0];
  };

  const expectSemanticFailureAndUnchangedContext = async (
    id: string,
    body: Record<string, unknown>,
    expectedContext: Record<string, unknown>,
  ) => {
    await guardedPost(`/v1/onboardings/${id}/submit`)
      .send(body)
      .expect(400)
      .expect((response) => {
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({
          type: '/problems/invalid-step-data',
          title: 'Invalid step data',
          status: 400,
          code: 'INVALID_STEP_DATA',
        });
      });

    expect(await readOnboarding(id)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        context: expectedContext,
      }),
    );
  };

  afterAll(async () => {
    if (app && createdOnboardingIds.size > 0) {
      await app
        .get(DataSource)
        .query('DELETE FROM onboardings WHERE id = ANY($1::uuid[])', [
          Array.from(createdOnboardingIds),
        ]);
    }

    if (app) {
      await app.close();
    }
  });

  it('starts a base onboarding in the first awaiting-user step', async () => {
    await startOnboarding();
  });

  it('lists seeded admin onboarding summaries for an unfiltered request with deterministic ordering', async () => {
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 11,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-a', email: 'alpha@example.com' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 12,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-b', email: 'beta@example.com' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: '2024-01-01T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 13,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-c', email: 'gamma@example.com' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings().expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[2],
          workflowId: 'workflow-gamma',
          workflowVersion: 13,
          status: 'awaiting_user',
          currentStep: 'review_profile',
          expiresAt: null,
          createdAt: '2024-01-02T00:00:00.000Z',
          updatedAt: '2024-01-02T00:00:00.000Z',
          completedAt: null,
        },
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 12,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: '2024-01-01T00:01:00.000Z',
        },
        {
          onboardingId: seededIds[0],
          workflowId: 'workflow-alpha',
          workflowVersion: 11,
          status: 'awaiting_user',
          currentStep: 'collect_email',
          expiresAt: null,
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact workflow version', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 21,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-version-1' },
        createdAt: '2024-02-01T00:00:00.000Z',
        updatedAt: '2024-02-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 22,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-version-2' },
        createdAt: '2024-02-02T00:00:00.000Z',
        updatedAt: '2024-02-02T00:00:00.000Z',
        completedAt: '2024-02-02T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 23,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-version-3' },
        createdAt: '2024-02-03T00:00:00.000Z',
        updatedAt: '2024-02-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings('?workflowVersion=22').expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 22,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-02-02T00:00:00.000Z',
          updatedAt: '2024-02-02T00:00:00.000Z',
          completedAt: '2024-02-02T00:01:00.000Z',
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact current step', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 31,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-step-1' },
        createdAt: '2024-03-01T00:00:00.000Z',
        updatedAt: '2024-03-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 32,
        status: 'awaiting_user' as const,
        currentStep: 'accept_terms',
        context: { source: 'seed-step-2' },
        createdAt: '2024-03-02T00:00:00.000Z',
        updatedAt: '2024-03-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-gamma',
        workflowVersion: 33,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-step-3' },
        createdAt: '2024-03-03T00:00:00.000Z',
        updatedAt: '2024-03-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings('?currentStep=accept_terms').expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 32,
          status: 'awaiting_user',
          currentStep: 'accept_terms',
          expiresAt: null,
          createdAt: '2024-03-02T00:00:00.000Z',
          updatedAt: '2024-03-02T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact onboarding id', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 41,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-id-1' },
        createdAt: '2024-04-01T00:00:00.000Z',
        updatedAt: '2024-04-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 42,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-id-2' },
        createdAt: '2024-04-02T00:00:00.000Z',
        updatedAt: '2024-04-02T00:00:00.000Z',
        completedAt: '2024-04-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings(`?onboardingId=${seededIds[1]}`).expect(200);

      expectSeededAdminOnboardingSummaries(response.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 42,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-04-02T00:00:00.000Z',
          updatedAt: '2024-04-02T00:00:00.000Z',
          completedAt: '2024-04-02T00:01:00.000Z',
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('combines status and workflow version filters and workflow id with current step filters using AND semantics', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 51,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-and-1' },
        createdAt: '2024-05-01T00:00:00.000Z',
        updatedAt: '2024-05-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 52,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-and-2' },
        createdAt: '2024-05-02T00:00:00.000Z',
        updatedAt: '2024-05-02T00:00:00.000Z',
        completedAt: '2024-05-02T00:01:00.000Z',
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 53,
        status: 'awaiting_user' as const,
        currentStep: 'review_profile',
        context: { source: 'seed-and-3' },
        createdAt: '2024-05-03T00:00:00.000Z',
        updatedAt: '2024-05-03T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const statusAndVersionResponse = await getAdminOnboardings(
        '?status=approved&workflowVersion=52',
      ).expect(200);
      expectSeededAdminOnboardingSummaries(statusAndVersionResponse.body, seededIds, [
        {
          onboardingId: seededIds[1],
          workflowId: 'workflow-beta',
          workflowVersion: 52,
          status: 'approved',
          currentStep: null,
          expiresAt: null,
          createdAt: '2024-05-02T00:00:00.000Z',
          updatedAt: '2024-05-02T00:00:00.000Z',
          completedAt: '2024-05-02T00:01:00.000Z',
        },
      ]);

      const workflowAndStepResponse = await getAdminOnboardings(
        '?workflowId=workflow-beta&currentStep=review_profile',
      ).expect(200);
      expectSeededAdminOnboardingSummaries(workflowAndStepResponse.body, seededIds, [
        {
          onboardingId: seededIds[2],
          workflowId: 'workflow-beta',
          workflowVersion: 53,
          status: 'awaiting_user',
          currentStep: 'review_profile',
          expiresAt: null,
          createdAt: '2024-05-03T00:00:00.000Z',
          updatedAt: '2024-05-03T00:00:00.000Z',
          completedAt: null,
        },
      ]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('returns an empty list for a valid no-match filter combination', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-alpha',
        workflowVersion: 61,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-no-match-1' },
        createdAt: '2024-06-01T00:00:00.000Z',
        updatedAt: '2024-06-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-beta',
        workflowVersion: 62,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-no-match-2' },
        createdAt: '2024-06-02T00:00:00.000Z',
        updatedAt: '2024-06-02T00:00:00.000Z',
        completedAt: '2024-06-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await getAdminOnboardings(
        '?status=approved&workflowId=does-not-exist&workflowVersion=999&currentStep=missing-step&onboardingId=ffffffff-ffff-4fff-8fff-ffffffffffff',
      ).expect(200);

      expect(response.body).toEqual([]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact status', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-status-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-status-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: '2024-01-02T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await http().get('/v1/admin/onboardings?status=awaiting_user').expect(200);
      const seededResponses = response.body.filter((item: Record<string, unknown>) =>
        seededIds.includes(item.onboardingId as string),
      );

      expect(seededResponses).toHaveLength(1);
      expect(seededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[0],
          status: 'awaiting_user',
          workflowId: 'workflow-a',
        }),
      );
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('filters admin onboarding summaries by exact workflow id', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-workflow-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-workflow-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const response = await http().get('/v1/admin/onboardings?workflowId=workflow-b').expect(200);
      const seededResponses = response.body.filter((item: Record<string, unknown>) =>
        seededIds.includes(item.onboardingId as string),
      );

      expect(seededResponses).toHaveLength(1);
      expect(seededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[1],
          workflowId: 'workflow-b',
        }),
      );
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it('composes status and workflow id filters with AND semantics and returns an empty list for no matches', async () => {
    const baselineOnboardingIds = await snapshotExistingOnboardingIds();
    const seededRows = [
      {
        workflowId: 'workflow-a',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-combined-1' },
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-01-01T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'awaiting_user' as const,
        currentStep: 'collect_email',
        context: { source: 'seed-combined-2' },
        createdAt: '2024-01-02T00:00:00.000Z',
        updatedAt: '2024-01-02T00:00:00.000Z',
        completedAt: null,
        expiresAt: null,
      },
      {
        workflowId: 'workflow-b',
        workflowVersion: 1,
        status: 'approved' as const,
        currentStep: null,
        context: { source: 'seed-combined-3' },
        createdAt: '2024-01-03T00:00:00.000Z',
        updatedAt: '2024-01-03T00:00:00.000Z',
        completedAt: '2024-01-03T00:01:00.000Z',
        expiresAt: null,
      },
    ];

    const seededIds = await seedAdminOnboardingsFixtures(seededRows);

    try {
      const combinedResponse = await http()
        .get('/v1/admin/onboardings?status=awaiting_user&workflowId=workflow-b')
        .expect(200);
      const combinedSeededResponses = combinedResponse.body.filter(
        (item: Record<string, unknown>) => seededIds.includes(item.onboardingId as string),
      );

      expect(combinedSeededResponses).toHaveLength(1);
      expect(combinedSeededResponses[0]).toEqual(
        expect.objectContaining({
          onboardingId: seededIds[1],
          workflowId: 'workflow-b',
          status: 'awaiting_user',
        }),
      );

      const noMatchResponse = await http()
        .get('/v1/admin/onboardings?status=approved&workflowId=does-not-exist')
        .expect(200);
      expect(noMatchResponse.body).toEqual([]);
    } finally {
      await cleanupAdminOnboardingsFixtures(seededIds);
      const remainingOnboardingIds = await snapshotExistingOnboardingIds();
      expect(remainingOnboardingIds).toEqual(expect.arrayContaining(baselineOnboardingIds));
    }
  });

  it.each([
    ['invalid status', '?status=invalid'],
    ['blank workflow id', '?workflowId='],
    ['whitespace-only workflow id', '?workflowId=%20%20%20'],
    ['oversized workflow id', `?workflowId=${'x'.repeat(101)}`],
  ])('rejects %s through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it.each([
    ['zero', '?workflowVersion=0'],
    ['negative', '?workflowVersion=-1'],
    ['decimal', '?workflowVersion=1.5'],
    ['non-numeric', '?workflowVersion=abc'],
    ['blank', '?workflowVersion='],
    ['non-finite', '?workflowVersion=Infinity'],
    ['repeated', '?workflowVersion=1&workflowVersion=2'],
  ])('rejects %s workflowVersion through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array workflowVersion values through global validation', async () => {
    await getAdminOnboardings({ workflowVersion: ['1', '2'] }).expect(400);
  });

  it.each([
    ['blank', '?currentStep='],
    ['whitespace-only', '?currentStep=%20%20%20'],
    ['oversized', `?currentStep=${'x'.repeat(101)}`],
    ['repeated', '?currentStep=collect_email&currentStep=accept_terms'],
  ])('rejects %s currentStep through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array currentStep values through global validation', async () => {
    await getAdminOnboardings({ currentStep: ['collect_email', 'accept_terms'] }).expect(400);
  });

  it.each([
    ['malformed', '?onboardingId=not-a-uuid'],
    ['blank', '?onboardingId='],
    [
      'repeated',
      '?onboardingId=00000000-0000-4000-8000-000000000011&onboardingId=00000000-0000-4000-8000-000000000012',
    ],
  ])('rejects %s onboardingId through global validation', async (_label, query) => {
    await getAdminOnboardings(query).expect(400);
  });

  it('rejects array onboardingId values through global validation', async () => {
    await getAdminOnboardings({
      onboardingId: [
        '00000000-0000-4000-8000-000000000011',
        '00000000-0000-4000-8000-000000000012',
      ],
    }).expect(400);
  });

  it.each([{}, { workflowId: '' }])('rejects a missing or blank workflow id', async (body) => {
    await guardedPost('/v1/onboardings').send(body).expect(400);
  });

  it('does not accept flowId as an initialization alias', async () => {
    await guardedPost('/v1/onboardings').send({ flowId: 'base' }).expect(400);
  });

  it('rejects an unknown flow with a stable not-found response', async () => {
    const response = await guardedPost('/v1/onboardings')
      .send({ workflowId: 'unknown' })
      .expect(404);

    expect(response.body).toEqual({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
  });

  it('rejects guarded onboarding routes when credentials are missing', async () => {
    await http().post('/v1/onboardings').send({ workflowId: 'base' }).expect(401);
  });

  it('rejects guarded onboarding routes when credentials are incorrect', async () => {
    await http()
      .post('/v1/onboardings')
      .set('x-engine-service-secret', 'wrong-secret')
      .send({ workflowId: 'base' })
      .expect(401);
  });

  it('rejects missing credentials on guarded read and submit routes', async () => {
    const onboardingId = await startOnboarding();

    await http().get(`/v1/onboardings/${onboardingId}`).expect(401);
    await http().get(`/v1/onboardings/${onboardingId}/state`).expect(401);
    await http().get(`/v1/onboardings/${onboardingId}/history`).expect(401);
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect(401);
  });

  it('rejects incorrect credentials on guarded read and submit routes', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .get(`/v1/onboardings/${onboardingId}`)
      .set('x-engine-service-secret', 'wrong-secret')
      .expect(401);
    await http()
      .get(`/v1/onboardings/${onboardingId}/state`)
      .set('x-engine-service-secret', 'wrong-secret')
      .expect(401);
    await http()
      .get(`/v1/onboardings/${onboardingId}/history`)
      .set('x-engine-service-secret', 'wrong-secret')
      .expect(401);
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .set('x-engine-service-secret', 'wrong-secret')
      .send(VALID_CONTACT_SUBMIT)
      .expect(401);
  });

  it('returns different ids for two valid starts', async () => {
    const first = await startOnboarding();
    const second = await startOnboarding();

    expect(first).not.toBe(second);
  });

  it('progresses through the contact submit and protects the completed state', async () => {
    const onboardingId = await startOnboarding();
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    expect(firstConnector.type).toBe('mock_kyc_1');
    expect(secondConnector.type).toBe('mock_kyc_2');
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        kind: 'accepted',
        appliedStep: 'collect_contact',
        status: 'approved',
        currentStep: null,
      });

    expect(firstVerifySpy).toHaveBeenCalledWith({
      context: {
        email: 'person@example.com',
        phone: '+48123456789',
        acceptedTerms: true,
        privacyAcknowledged: true,
      },
      payload: { email: 'person@example.com' },
    });
    expect(firstVerifySpy).toHaveBeenCalledTimes(1);

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.completed_at).not.toBeNull();
    expect(completed.context).toEqual(
      expect.objectContaining({
        'contact.email': 'person@example.com',
        'contact.phone': '+48123456789',
        'consent.termsVersion': 'v1',
        'consent.termsAcceptedAt': expect.any(String),
        'consent.privacyVersion': 'v1',
        'consent.privacyAcknowledgedAt': expect.any(String),
      }),
    );

    expect(secondVerifySpy).toHaveBeenCalledWith({
      context: {
        email: 'person@example.com',
        phone: '+48123456789',
        acceptedTerms: true,
        privacyAcknowledged: true,
      },
      payload: { email: 'person@example.com', acceptedTerms: true },
    });
    expect(secondVerifySpy).toHaveBeenCalledTimes(1);

    const firstConnectorCallOrder = firstVerifySpy.mock.invocationCallOrder[0];
    const secondConnectorCallOrder = secondVerifySpy.mock.invocationCallOrder[0];
    expect(firstConnectorCallOrder).toBeDefined();
    expect(secondConnectorCallOrder).toBeDefined();
    expect(firstConnectorCallOrder).toBeLessThan(secondConnectorCallOrder);

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    expect(await readOnboarding(onboardingId)).toEqual(completed);
    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('does not invoke the connector or mutate state for invalid submit input', async () => {
    const onboardingId = await startOnboarding();
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'not-an-email' })
      .expect(400)
      .expect((response) => {
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({
          type: '/problems/invalid-step-data',
          title: 'Invalid step data',
          status: 400,
          code: 'INVALID_STEP_DATA',
        });
      });

    expect(firstVerifySpy).not.toHaveBeenCalled();
    expect(secondVerifySpy).not.toHaveBeenCalled();
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_contact',
        context: {},
      }),
    );

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('exposes only the canonical generic submit route', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/steps/collect_contact/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect(404);
    await http()
      .post(`/v1/onboardings/${onboardingId}/collect_contact/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect(404);
    await http()
      .post(`/v1/onboardings/${onboardingId}/user-id/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/bff/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/public/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send({ stepId: 'collect_contact', email: 'person@example.com' })
      .expect(400)
      .expect((response) => {
        expect(response.headers['content-type']).toContain('application/problem+json');
        expect(response.body).toMatchObject({
          type: '/problems/invalid-step-data',
          title: 'Invalid step data',
          status: 400,
          code: 'INVALID_STEP_DATA',
        });
      });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_contact',
        context: {},
      }),
    );
  });

  it('keeps the active step and context unchanged after each semantic failure', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const emptyEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(emptyEmail, {}, {});
    await guardedPost(`/v1/onboardings/${emptyEmail}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const invalidEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(
      invalidEmail,
      {
        email: 'not-an-email',
        phone: '+48123456789',
        acceptedTerms: true,
        privacyAcknowledged: true,
      },
      {},
    );
    await guardedPost(`/v1/onboardings/${invalidEmail}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const falseConsent = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(
      falseConsent,
      {
        email: 'valid@example.com',
        phone: '+48123456789',
        acceptedTerms: false,
        privacyAcknowledged: true,
      },
      {},
    );
    await guardedPost(`/v1/onboardings/${falseConsent}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const missingConsent = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(
      missingConsent,
      { email: 'valid@example.com', phone: '+48123456789' },
      {},
    );
    await guardedPost(`/v1/onboardings/${missingConsent}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const inactiveField = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(
      inactiveField,
      { ...VALID_CONTACT_SUBMIT, unexpected: 'discard-me' },
      {},
    );
    await guardedPost(`/v1/onboardings/${inactiveField}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('returns the semantic error for wrong primitive types', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const emailType = await startOnboarding();
    const emailError = await guardedPost(`/v1/onboardings/${emailType}/submit`)
      .send({ email: 123, phone: '+48123456789', acceptedTerms: true, privacyAcknowledged: true })
      .expect(400);
    expect(emailError.body).toMatchObject({
      type: '/problems/invalid-step-data',
      title: 'Invalid step data',
      status: 400,
      code: 'INVALID_STEP_DATA',
      fieldErrors: [{ field: 'email', code: 'INVALID_TYPE' }],
    });
    expect(await readOnboarding(emailType)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_contact',
        context: {},
      }),
    );
    await guardedPost(`/v1/onboardings/${emailType}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const consentType = await startOnboarding();
    const consentError = await guardedPost(`/v1/onboardings/${consentType}/submit`)
      .send({
        email: 'valid@example.com',
        phone: '+48123456789',
        acceptedTerms: 'true',
        privacyAcknowledged: true,
      })
      .expect(400);
    expect(consentError.body).toMatchObject({
      type: '/problems/invalid-step-data',
      title: 'Invalid step data',
      status: 400,
      code: 'INVALID_STEP_DATA',
      fieldErrors: [{ field: 'acceptedTerms', code: 'INVALID_TYPE' }],
    });
    expect(await readOnboarding(consentType)).toEqual(
      expect.objectContaining({
        context: {},
        current_step: 'collect_contact',
      }),
    );
    await guardedPost(`/v1/onboardings/${consentType}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a JSON string', JSON.stringify('person@example.com')],
    ['a JSON number', '123'],
    ['a JSON boolean', 'true'],
  ])('rejects %s submit bodies through the JSON transport', async (_label, body) => {
    const onboardingId = await startOnboarding();

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400)
      .expect((response) => {
        expect(response.body).toMatchObject({ code: 'INVALID_STEP_DATA' });
      });

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_contact',
        context: {},
      }),
    );
  });

  it('preserves configured dynamic keys and rejects undeclared data without mutation', async () => {
    const firstConnector = getApp().get(TshKyc1Connector);
    const secondConnector = getApp().get(TshKyc2Connector);
    const firstVerifySpy = jest.spyOn(firstConnector, 'verify').mockResolvedValue(true);
    const secondVerifySpy = jest.spyOn(secondConnector, 'verify').mockResolvedValue(true);

    const onboardingId = await startOnboarding();

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send({
        email: 'person@example.com',
        phone: '+48123456789',
        acceptedTerms: true,
        privacyAcknowledged: true,
        unexpected: 'discard-me',
      })
      .expect(400)
      .expect((response) => {
        expect(response.body).toMatchObject({
          type: '/problems/invalid-step-data',
          title: 'Invalid step data',
          status: 400,
          code: 'INVALID_STEP_DATA',
        });
        expect(response.body.fieldErrors).toContainEqual({
          field: 'unexpected',
          code: 'UNDECLARED_FIELD',
        });
      });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_contact',
        context: {},
      }),
    );

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          'contact.email': 'person@example.com',
          'contact.phone': '+48123456789',
          'consent.termsVersion': 'v1',
          'consent.privacyVersion': 'v1',
        }),
        current_step: null,
        status: 'approved',
      }),
    );

    firstVerifySpy.mockRestore();
    secondVerifySpy.mockRestore();
  });

  it('rejects unknown onboarding ids with a stable body', async () => {
    await guardedPost('/v1/onboardings/01900000-0000-7000-8000-000000000000/submit')
      .send({ email: 'person@example.com' })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
  });

  it('rejects malformed onboarding ids with a stable not-found body on read and submit routes', async () => {
    const malformedOnboardingId = 'not-a-uuid';

    await guardedGet(`/v1/onboardings/${malformedOnboardingId}`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    await guardedGet(`/v1/onboardings/${malformedOnboardingId}/state`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    await guardedGet(`/v1/onboardings/${malformedOnboardingId}/history`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    await guardedPost(`/v1/onboardings/${malformedOnboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
  });

  it('rejects unknown onboarding ids on read routes with the stable not-found body', async () => {
    const unknownOnboardingId = '01900000-0000-7000-8000-000000000001';

    await guardedGet(`/v1/onboardings/${unknownOnboardingId}`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    await guardedGet(`/v1/onboardings/${unknownOnboardingId}/state`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
    await guardedGet(`/v1/onboardings/${unknownOnboardingId}/history`)
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
  });

  it('serializes completed state descriptors with currentStep set to null', async () => {
    const onboardingId = await startOnboarding();

    await guardedPost(`/v1/onboardings/${onboardingId}/submit`)
      .send(VALID_CONTACT_SUBMIT)
      .expect((response) => expect([200, 201]).toContain(response.status));

    const journeyResponse = await guardedGet(`/v1/onboardings/${onboardingId}`).expect(200);
    expect(journeyResponse.body).toMatchObject({
      onboardingId,
      status: 'approved',
      currentStep: null,
    });
    expect(Object.prototype.hasOwnProperty.call(journeyResponse.body, 'currentStep')).toBe(true);

    const stateResponse = await guardedGet(`/v1/onboardings/${onboardingId}/state`).expect(200);
    expect(stateResponse.body).toMatchObject({
      onboardingId,
      status: 'approved',
      currentStep: null,
    });
    expect(Object.prototype.hasOwnProperty.call(stateResponse.body, 'currentStep')).toBe(true);
  });

  it('continues a persisted onboarding through a fresh service instance', async () => {
    const onboardingId = await startOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;
    const freshService = new OnboardingsService(
      dataSource,
      new OnboardingsRepository(),
      getApp().get(WorkflowRegistryService),
    );

    await expect(
      freshService.submit(onboardingId, { ...VALID_CONTACT_SUBMIT, email: 'fresh@example.com' }),
    ).resolves.toEqual({
      kind: 'accepted',
      appliedStep: 'collect_contact',
      status: 'approved',
      currentStep: null,
    });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: expect.objectContaining({
          'contact.email': 'fresh@example.com',
          'contact.phone': '+48123456789',
        }),
        current_step: null,
      }),
    );
  });

  it('proves the real Postgres row lock rejects a stale submit after release', async () => {
    const onboardingId = await startOnboarding();
    const dataSource = getApp().get(DataSource) as DataSource;
    const holder = dataSource.createQueryRunner();
    let staleSettled = false;

    try {
      await holder.connect();
      await holder.startTransaction();
      await holder.query('SELECT id FROM onboardings WHERE id = $1 FOR UPDATE', [onboardingId]);
      await holder.query(
        `UPDATE onboardings
         SET current_step = 'collect_contact', context = $2::jsonb, status = 'awaiting_user', completed_at = NULL
         WHERE id = $1`,
        [onboardingId, JSON.stringify({ email: 'holder@example.com' })],
      );

      const staleSubmit = guardedPost(`/v1/onboardings/${onboardingId}/submit`)
        .send({ email: 'stale@example.com' })
        .then((response) => {
          staleSettled = true;
          return response;
        });

      const barrierDeadline = Date.now() + 5000;
      let lockWaitObserved = false;
      while (!lockWaitObserved && !staleSettled && Date.now() < barrierDeadline) {
        const waiting = await dataSource.query(
          `SELECT 1
           FROM pg_stat_activity
           WHERE wait_event_type = 'Lock'
             AND query ILIKE '%FOR UPDATE%'
             AND pid <> pg_backend_pid()
           LIMIT 1`,
        );
        lockWaitObserved = waiting.length === 1;
        if (!lockWaitObserved) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
      }

      expect(staleSettled).toBe(false);
      expect(lockWaitObserved).toBe(true);

      await holder.commitTransaction();
      await expect(staleSubmit).resolves.toMatchObject({
        status: 400,
        body: expect.objectContaining({
          type: '/problems/invalid-step-data',
          title: 'Invalid step data',
          status: 400,
          code: 'INVALID_STEP_DATA',
        }),
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'collect_contact',
          context: { email: 'holder@example.com' },
        }),
      );
    } finally {
      if (holder.isTransactionActive) {
        await holder.rollbackTransaction();
      }
      await holder.release();
    }
  });

  it('applies only the bootstrap and onboarding migrations without deferred storage', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const migrations = await dataSource.query(
      `SELECT name
       FROM migrations
       ORDER BY id`,
    );

    expect(migrations).toEqual([
      { name: '0001_init' },
      { name: '0002_create_onboardings_1735689600000' },
      { name: '0003_create_step_history_1735689600001' },
    ]);

    const tables = await dataSource.query(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
       ORDER BY table_name`,
    );
    expect(tables).toEqual([
      { table_name: '_engine_alive' },
      { table_name: 'migrations' },
      { table_name: 'onboardings' },
      { table_name: 'step_history' },
    ]);
  });

  it('asserts the durable onboardings schema shape and primary-key-only index inventory', async () => {
    const dataSource = getApp().get(DataSource) as DataSource;
    const tableResult = await dataSource.query("SELECT to_regclass('onboardings') AS table_name");
    expect(tableResult).toEqual([{ table_name: 'onboardings' }]);

    const columns = await dataSource.query(
      `SELECT column_name, data_type, udt_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'onboardings'
       ORDER BY ordinal_position`,
    );
    expect(columns).toEqual([
      {
        column_name: 'id',
        data_type: 'uuid',
        udt_name: 'uuid',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'workflow_id',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'workflow_version',
        data_type: 'integer',
        udt_name: 'int4',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'status',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'NO',
        column_default: null,
      },
      {
        column_name: 'current_step',
        data_type: 'character varying',
        udt_name: 'varchar',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'context',
        data_type: 'jsonb',
        udt_name: 'jsonb',
        is_nullable: 'NO',
        column_default: "'{}'::jsonb",
      },
      {
        column_name: 'expires_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
        column_default: null,
      },
      {
        column_name: 'created_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'updated_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'NO',
        column_default: 'now()',
      },
      {
        column_name: 'completed_at',
        data_type: 'timestamp with time zone',
        udt_name: 'timestamptz',
        is_nullable: 'YES',
        column_default: null,
      },
    ]);

    const indexes = await dataSource.query(
      `SELECT indexname, indexdef
       FROM pg_indexes
       WHERE schemaname = 'public' AND tablename = 'onboardings'
       ORDER BY indexname`,
    );
    expect(indexes).toHaveLength(1);
    expect(indexes[0].indexname).toBe('onboardings_pkey');
    expect(indexes[0].indexdef).toContain('UNIQUE INDEX onboardings_pkey');
    expect(indexes[0].indexdef).toContain('ON public.onboardings USING btree (id)');

    const constraints = await dataSource.query(
      `SELECT conname, pg_get_constraintdef(oid) AS definition
       FROM pg_constraint
       WHERE conrelid = 'public.onboardings'::regclass AND contype = 'c'
       ORDER BY conname`,
    );
    expect(constraints).toEqual([
      {
        conname: 'chk_onboardings_context_object',
        definition: "CHECK ((jsonb_typeof(context) = 'object'::text))",
      },
      {
        conname: 'chk_onboardings_current_step_nonempty',
        definition: "CHECK (((current_step IS NULL) OR (btrim((current_step)::text) <> ''::text)))",
      },
      {
        conname: 'chk_onboardings_lifecycle_state',
        definition:
          "CHECK (((((status)::text = 'awaiting_user'::text) AND (current_step IS NOT NULL) AND (completed_at IS NULL)) OR (((status)::text = 'approved'::text) AND (current_step IS NULL) AND (completed_at IS NOT NULL))))",
      },
      {
        conname: 'chk_onboardings_status',
        definition:
          "CHECK (((status)::text = ANY ((ARRAY['awaiting_user'::character varying, 'approved'::character varying])::text[])))",
      },
      {
        conname: 'chk_onboardings_workflow_id_nonempty',
        definition: "CHECK ((btrim((workflow_id)::text) <> ''::text))",
      },
      {
        conname: 'chk_onboardings_workflow_version_positive',
        definition: 'CHECK ((workflow_version > 0))',
      },
    ]);
  });
});
