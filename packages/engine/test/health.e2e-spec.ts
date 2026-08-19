import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

describe('HealthController (e2e)', () => {
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
