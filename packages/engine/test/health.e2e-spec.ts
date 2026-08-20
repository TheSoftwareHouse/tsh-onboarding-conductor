import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

describe('HealthController (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    // This suite sends no Entra ID token; admin auth has its own e2e spec.
    process.env.ADMIN_AUTH_ENABLED = 'false';
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

    app = moduleFixture.createNestApplication<NestExpressApplication>(undefined, {
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

  afterAll(async () => {
    await app?.close();
  });

  it('returns the live health response', async () => {
    await request(app.getHttpServer()).get('/v1/health/live').expect(200).expect({ status: 'ok' });
  });

  it('applies the bootstrap migration and seeds the alive marker table', async () => {
    const dataSource = app?.get(DataSource) as DataSource;
    const tableResult = await dataSource.query("SELECT to_regclass('_engine_alive') AS table_name");

    expect(tableResult[0].table_name).toBe('_engine_alive');

    const rowCount = await dataSource.query('SELECT count(*)::int AS count FROM _engine_alive');
    expect(rowCount).toEqual([{ count: 1 }]);
  });
});
