import 'reflect-metadata';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

import { Controller, Get, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startE2eServer } from './e2e-server';

const INDEX_HTML = '<!doctype html><html><body><div id="app"></div></body></html>';
const ASSET_JS = 'console.log("panel");';

// A stand-in for `packages/admin-panel/dist`, so the suite proves the serving behaviour without
// depending on the panel having been built.
const distDir = mkdtempSync(join(tmpdir(), 'admin-panel-dist-'));
mkdirSync(join(distDir, 'assets'));
writeFileSync(join(distDir, 'index.html'), INDEX_HTML);
writeFileSync(join(distDir, 'assets', 'index-abc123.js'), ASSET_JS);
// The placeholder the panel's `public/` ships for `pnpm dev`. The engine must answer /config.js
// ahead of the static handler, so this file must never reach the browser from a container.
writeFileSync(join(distDir, 'config.js'), 'window.__ENV__ = {};\n');

// This suite sends no Entra ID token; admin auth has its own e2e spec.
process.env.ADMIN_AUTH_ENABLED = 'false';
process.env.PORT = '3002';
process.env.ADMIN_PANEL_ORIGIN = 'http://localhost:5173';
process.env.ADMIN_PANEL_DIST_DIR = distDir;
process.env.VITE_AUTH_ENABLED = 'false';
process.env.VITE_AZURE_CLIENT_ID = '';

import { createApp } from '../src/main';
import { validateConfig } from '../src/config/app.config';

// Importing `../src/main` pulls in `AppModule`, whose own `ConfigModule.forRoot()` runs while the
// decorator is evaluated and loads the repository's `.env` into `process.env`. Clearing the
// variable above that import would therefore be undone by the import itself, and the same-origin
// default this suite checks would never be exercised. It has to be cleared here instead — after
// the import, before the `TestAppModule` below is declared and reads the environment.
delete process.env.VITE_ENGINE_API_BASE_URL;

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

describe('Admin panel served by the engine (e2e)', () => {
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    const createdApp = await createApp(TestAppModule);
    app = createdApp.app;
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('still routes the engine API, which the panel must never shadow', async () => {
    const response = await request(app!.getHttpServer()).get('/v1/health/live').expect(200);

    expect(response.body).toEqual({ status: 'ok' });
  });

  it('404s an unknown API route rather than answering it with the panel', async () => {
    await request(app!.getHttpServer()).get('/v1/nope').expect(404);
  });

  it('serves the panel at the root', async () => {
    const response = await request(app!.getHttpServer()).get('/').expect(200);

    expect(response.text).toBe(INDEX_HTML);
  });

  it('serves hashed assets as themselves', async () => {
    const response = await request(app!.getHttpServer()).get('/assets/index-abc123.js').expect(200);

    expect(response.text).toBe(ASSET_JS);
  });

  it('falls back to index.html on a client-side route, so a hard refresh resolves', async () => {
    const response = await request(app!.getHttpServer()).get('/audit').expect(200);

    expect(response.text).toBe(INDEX_HTML);
    expect(response.headers['cache-control']).toBe('no-cache');
  });

  it('renders /config.js from configuration instead of serving the dev placeholder', async () => {
    const response = await request(app!.getHttpServer()).get('/config.js').expect(200);

    expect(response.headers['content-type']).toContain('javascript');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.text).toContain('"VITE_AUTH_ENABLED": "false"');
    // Unset and empty keys are omitted so the panel falls back to its build-time value.
    expect(response.text).not.toContain('VITE_AZURE_CLIENT_ID');
  });

  it('points the panel at this engine, so a remapped host port cannot break it', async () => {
    const response = await request(app!.getHttpServer()).get('/config.js').expect(200);

    expect(response.text).toContain('"VITE_ENGINE_API_BASE_URL": "/"');
  });

  it("reports the engine's own NODE_ENV and environment name", async () => {
    const response = await request(app!.getHttpServer()).get('/config.js').expect(200);
    const configService = app!.get(ConfigService);

    expect(response.text).toContain(
      `"VITE_ENVIRONMENT_NAME": "${configService.get<string>('ENVIRONMENT_NAME')}"`,
    );
    expect(response.text).toContain(`"VITE_NODE_ENV": "${configService.get<string>('NODE_ENV')}"`);
  });

  it('leaves non-GET requests to the API, which owns every write', async () => {
    await request(app!.getHttpServer()).post('/audit').expect(404);
  });
});
