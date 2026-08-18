import 'reflect-metadata';
import path from 'node:path';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3001';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.STORAGE_DRIVER = 's3';
process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.WORKFLOWS_DIR = path.resolve(__dirname, 'fixtures', 'workflows');
process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM = 'no-reply@example.com';

import { createApp } from '../src/main';
import { validateConfig } from '../src/config/app.config';

@Controller()
class TestHealthController {
  @Get('/v1/health/live')
  getLive() {
    return { status: 'ok' };
  }
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [],
      ignoreEnvFile: true,
      validate: validateConfig,
    }),
  ],
  controllers: [TestHealthController],
})
class TestAppModule {}

describe('Admin panel CORS (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    const createdApp = await createApp(TestAppModule);
    app = createdApp.app;
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows the configured origin for GET requests', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
  });

  it('answers OPTIONS preflights for the configured origin', async () => {
    const response = await request(app!.getHttpServer())
      .options('/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type')
      .send();

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-allow-methods']).toContain('OPTIONS');
  });

  it('rejects non-matching origins', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://evil.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
