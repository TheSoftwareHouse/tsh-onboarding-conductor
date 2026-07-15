import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

describe('HealthController (e2e)', () => {
  let app: INestApplication | undefined;

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

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the live health response', async () => {
    await request(app.getHttpServer()).get('/v1/health/live').expect(200).expect({ status: 'ok' });
  });

  it('starts a base onboarding and returns the completed response', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/onboardings')
      .send({ flowId: 'base' })
      .expect(201);

    expect(response.body).toEqual({
      onboardingId: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      ),
      status: 'approved',
      currentStep: null,
      expiresAt: null,
    });
  });

  it.each([{}, { flowId: '' }])('rejects a missing or blank flow id', async (body) => {
    await request(app.getHttpServer()).post('/v1/onboardings').send(body).expect(400);
  });

  it('rejects an unknown flow with a stable not-found response', async () => {
    const response = await request(app.getHttpServer())
      .post('/v1/onboardings')
      .send({ flowId: 'unknown' })
      .expect(404);

    expect(response.body).toEqual(
      expect.objectContaining({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      }),
    );
  });

  it('returns different ids for two valid starts', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/onboardings')
      .send({ flowId: 'base' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/onboardings')
      .send({ flowId: 'base' })
      .expect(201);

    expect(first.body.onboardingId).not.toBe(second.body.onboardingId);
  });

  it('applies the bootstrap migration and seeds the alive marker table', async () => {
    const dataSource = app.get(DataSource);
    const tableResult = await dataSource.query("SELECT to_regclass('_engine_alive') AS table_name");

    expect(tableResult[0].table_name).toBe('_engine_alive');

    const rowCount = await dataSource.query('SELECT count(*)::int AS count FROM _engine_alive');
    expect(rowCount).toEqual([{ count: 1 }]);
  });
});
