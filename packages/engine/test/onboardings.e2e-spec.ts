import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { OnboardingsRepository } from '../src/onboardings/onboardings.repository';
import { OnboardingsService } from '../src/onboardings/onboardings.service';
import { WorkflowRegistryService } from '../src/workflows/workflow-registry.service';

const INVALID_STEP_DATA = {
  code: 'INVALID_STEP_DATA',
  message: 'INVALID_STEP_DATA',
};

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

  const startOnboarding = async () => {
    const response = await http().post('/v1/onboardings').send({ workflowId: 'base' }).expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'collect_email',
      expiresAt: null,
    });

    expect(response.body.onboardingId).not.toHaveLength(0);

    expect(await readOnboarding(response.body.onboardingId)).toEqual(
      expect.objectContaining({
        workflow_id: 'base',
        workflow_version: 1,
        status: 'awaiting_user',
        current_step: 'collect_email',
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
    const response = await http().post(`/v1/onboardings/${id}/submit`).send(body).expect(400);

    expect(response.body).toEqual(INVALID_STEP_DATA);
    expect(response.body).not.toHaveProperty('details');

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

  it.each([{}, { workflowId: '' }])('rejects a missing or blank workflow id', async (body) => {
    await http().post('/v1/onboardings').send(body).expect(400);
  });

  it('does not accept flowId as an initialization alias', async () => {
    await http().post('/v1/onboardings').send({ flowId: 'base' }).expect(400);
  });

  it('rejects an unknown flow with a stable not-found response', async () => {
    const response = await http()
      .post('/v1/onboardings')
      .send({ workflowId: 'unknown' })
      .expect(404);

    expect(response.body).toEqual({ code: 'WORKFLOW_NOT_FOUND', message: 'WORKFLOW_NOT_FOUND' });
  });

  it('returns different ids for two valid starts', async () => {
    const first = await startOnboarding();
    const second = await startOnboarding();

    expect(first).not.toBe(second);
  });

  it('progresses through both canonical HTTP submits and protects the completed state', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({
        appliedStep: 'collect_email',
        status: 'awaiting_user',
        currentStep: 'accept_terms',
      });

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status))
      .expect({ appliedStep: 'accept_terms', status: 'approved', currentStep: null });

    const completed = await readOnboarding(onboardingId);
    expect(completed.status).toBe('approved');
    expect(completed.current_step).toBeNull();
    expect(completed.completed_at).not.toBeNull();
    expect(completed.context).toEqual({ email: 'person@example.com', acceptedTerms: true });

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect(409)
      .expect({ code: 'ONBOARDING_COMPLETED', message: 'ONBOARDING_COMPLETED' });
    expect(await readOnboarding(onboardingId)).toEqual(completed);
  });

  it('exposes only the canonical generic submit route', async () => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/steps/collect_email/submit`)
      .send({ email: 'person@example.com' })
      .expect(404);
    await http()
      .post(`/v1/onboardings/${onboardingId}/collect_email/submit`)
      .send({ email: 'person@example.com' })
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

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ stepId: 'collect_email', email: 'person@example.com' })
      .expect(400)
      .expect(INVALID_STEP_DATA);
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_email',
        context: {},
      }),
    );
  });

  it('keeps the active step and context unchanged after each semantic failure', async () => {
    const emptyEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(emptyEmail, {}, {});
    await http()
      .post(`/v1/onboardings/${emptyEmail}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const invalidEmail = await startOnboarding();
    await expectSemanticFailureAndUnchangedContext(invalidEmail, { email: 'not-an-email' }, {});
    await http()
      .post(`/v1/onboardings/${invalidEmail}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const falseConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${falseConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      falseConsent,
      { acceptedTerms: false },
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${falseConsent}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const missingConsent = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${missingConsent}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      missingConsent,
      {},
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${missingConsent}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const inactiveField = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${inactiveField}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await expectSemanticFailureAndUnchangedContext(
      inactiveField,
      { email: 'valid@example.com' },
      { email: 'valid@example.com' },
    );
    await http()
      .post(`/v1/onboardings/${inactiveField}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));
  });

  it('returns the semantic error for wrong primitive types', async () => {
    const emailType = await startOnboarding();
    const emailError = await http()
      .post(`/v1/onboardings/${emailType}/submit`)
      .send({ email: 123 })
      .expect(400);
    expect(emailError.body).toEqual(INVALID_STEP_DATA);
    expect(emailError.body).not.toHaveProperty('details');
    expect(await readOnboarding(emailType)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );
    await http()
      .post(`/v1/onboardings/${emailType}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));

    const consentType = await startOnboarding();
    await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ email: 'valid@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    const consentError = await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ acceptedTerms: 'true' })
      .expect(400);
    expect(consentError.body).toEqual(INVALID_STEP_DATA);
    expect(consentError.body).not.toHaveProperty('details');
    expect(await readOnboarding(consentType)).toEqual(
      expect.objectContaining({
        context: { email: 'valid@example.com' },
        current_step: 'accept_terms',
      }),
    );
    await http()
      .post(`/v1/onboardings/${consentType}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));
  });

  it.each([
    ['null', 'null'],
    ['an array', '[]'],
    ['a JSON string', JSON.stringify('person@example.com')],
    ['a JSON number', '123'],
    ['a JSON boolean', 'true'],
  ])('rejects %s submit bodies through the JSON transport', async (_label, body) => {
    const onboardingId = await startOnboarding();

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .set('Content-Type', 'application/json')
      .send(body)
      .expect(400)
      .expect(INVALID_STEP_DATA);

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        status: 'awaiting_user',
        current_step: 'collect_email',
        context: {},
      }),
    );
  });

  it('preserves configured dynamic keys and rejects undeclared data without mutation', async () => {
    const onboardingId = await startOnboarding();

    const undeclaredResponse = await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com', unexpected: 'discard-me' })
      .expect(400);
    expect(undeclaredResponse.body).toEqual(INVALID_STEP_DATA);
    expect(undeclaredResponse.body).not.toHaveProperty('details');
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        current_step: 'collect_email',
        context: {},
      }),
    );

    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ email: 'person@example.com' })
      .expect((response) => expect([200, 201]).toContain(response.status));
    await http()
      .post(`/v1/onboardings/${onboardingId}/submit`)
      .send({ acceptedTerms: true })
      .expect((response) => expect([200, 201]).toContain(response.status));

    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: { email: 'person@example.com', acceptedTerms: true },
        current_step: null,
        status: 'approved',
      }),
    );
  });

  it('rejects unknown onboarding ids with a stable body', async () => {
    await http()
      .post('/v1/onboardings/01900000-0000-7000-8000-000000000000/submit')
      .send({ email: 'person@example.com' })
      .expect(404)
      .expect({ code: 'ONBOARDING_NOT_FOUND', message: 'ONBOARDING_NOT_FOUND' });
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
      freshService.submit(onboardingId, { email: 'fresh@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'collect_email',
      status: 'awaiting_user',
      currentStep: 'accept_terms',
    });
    expect(await readOnboarding(onboardingId)).toEqual(
      expect.objectContaining({
        context: { email: 'fresh@example.com' },
        current_step: 'accept_terms',
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
         SET current_step = 'accept_terms', context = $2::jsonb, status = 'awaiting_user', completed_at = NULL
         WHERE id = $1`,
        [onboardingId, JSON.stringify({ email: 'holder@example.com' })],
      );

      const staleSubmit = http()
        .post(`/v1/onboardings/${onboardingId}/submit`)
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
        body: INVALID_STEP_DATA,
      });
      expect(await readOnboarding(onboardingId)).toEqual(
        expect.objectContaining({
          status: 'awaiting_user',
          current_step: 'accept_terms',
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
