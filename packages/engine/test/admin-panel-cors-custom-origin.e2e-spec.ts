import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startE2eServer } from './e2e-server';

// This suite sends no Entra ID token; admin auth has its own e2e spec.
process.env.ADMIN_AUTH_ENABLED = 'false';
process.env.PORT = '3002';
process.env.ADMIN_PANEL_ORIGIN = 'http://admin.example:8080';

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

describe('Admin panel CORS with custom configured origin (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    const createdApp = await createApp(TestAppModule);
    app = createdApp.app;
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows the configured custom origin for GET requests', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://admin.example:8080')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBe('http://admin.example:8080');
  });

  it('answers OPTIONS preflights for the configured custom origin', async () => {
    const response = await request(app!.getHttpServer())
      .options('/v1/health/live')
      .set('Origin', 'http://admin.example:8080')
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'content-type')
      .send();

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe('http://admin.example:8080');
    expect(response.headers['access-control-allow-methods']).toContain('GET');
    expect(response.headers['access-control-allow-methods']).toContain('OPTIONS');
  });

  it('rejects the default localhost origin when a custom origin is configured', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rejects other non-matching origins', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://evil.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
