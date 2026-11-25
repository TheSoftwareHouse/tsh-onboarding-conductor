import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startE2eServer } from './e2e-server';

// This suite sends no admin session; admin auth has its own e2e spec.
process.env.ADMIN_AUTH_ENABLED = 'false';
process.env.PORT = '3001';
process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';

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
    await startE2eServer(app);
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

  it('allows credentials and POST for the configured origin', async () => {
    const response = await request(app!.getHttpServer())
      .options('/v1/health/live')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .send();

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['access-control-allow-methods']).toContain('POST');
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).not.toContain(
      'authorization',
    );
  });

  it('refuses to advertise credentials to a foreign origin', async () => {
    // The session cookie is the admin credential, so a permissive preflight here would let an
    // attacker's page make authenticated admin requests.
    const response = await request(app!.getHttpServer())
      .options('/v1/onboardings')
      .set('Origin', 'http://evil.example.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .send();

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('rejects non-matching origins', async () => {
    const response = await request(app!.getHttpServer())
      .get('/v1/health/live')
      .set('Origin', 'http://evil.example')
      .expect(200);

    expect(response.headers['access-control-allow-origin']).toBeUndefined();
  });
});
