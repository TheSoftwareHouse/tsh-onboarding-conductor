import 'reflect-metadata';
import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { startE2eServer } from './e2e-server';

const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3004';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.STORAGE_DRIVER = 's3';
process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
// The local escape hatch. Deliberately set with no Entra configuration alongside it, which is
// exactly the shape a fresh clone starts in.
process.env.ADMIN_AUTH_ENABLED = 'false';

import { createApp } from '../src/main';
import { validateConfig } from '../src/config/app.config';
import {
  ADMIN_ACCESS_AUDIT,
  type AdminAccessAuditEvent,
  type AdminAccessAuditPort,
} from '../src/auth/admin-access-audit.port';
import { ADMIN_TOKEN_VERIFIER } from '../src/auth/admin-token-verifier.port';
import { AzureJwtGuard } from '../src/auth/azure-jwt.guard';
import { toAdminAccessAuditInput } from '../src/audit/admin-access-audit.adapter';

const recordedAccess: AdminAccessAuditEvent[] = [];

@Controller()
class TestAdminController {
  @Get('/v1/onboardings')
  @UseGuards(AzureJwtGuard)
  listOnboardings() {
    return [];
  }

  @Get('/v1/admin/audit')
  @UseGuards(AzureJwtGuard)
  listAudit() {
    return [];
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
  controllers: [TestAdminController],
  providers: [
    {
      provide: ADMIN_ACCESS_AUDIT,
      useFactory: (): AdminAccessAuditPort => ({
        record: (event) => {
          recordedAccess.push(event);

          return Promise.resolve();
        },
      }),
    },
    // What the real factory hands over when the flag is off.
    { provide: ADMIN_TOKEN_VERIFIER, useValue: null },
    AzureJwtGuard,
  ],
})
class TestAppModule {}

/**
 * `ADMIN_AUTH_ENABLED=false` is the escape hatch that lets a fresh clone run without an Entra
 * tenant, and it is the one configuration in which admin data is served to anyone who asks. The
 * suite states that plainly, and pins the compensating control: the read is still audited.
 */
describe('Admin endpoints with authentication disabled (e2e)', () => {
  const adminRoutes = ['/v1/onboardings', '/v1/admin/audit'];
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    const createdApp = await createApp(TestAppModule);
    app = createdApp.app;
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    recordedAccess.length = 0;
  });

  describe.each(adminRoutes)('%s', (route) => {
    it('serves admin data to a caller with no credential whatsoever', async () => {
      await request(app!.getHttpServer()).get(route).expect(200);
    });

    it('serves it even when a plainly invalid credential is presented', async () => {
      // Nothing is verified in this mode, so a garbage token is neither better nor worse than none.
      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(200);
    });

    it('records the unauthenticated read, which is the only trace such access leaves', async () => {
      await request(app!.getHttpServer()).get(route).expect(200);

      expect(recordedAccess).toHaveLength(1);
      expect(toAdminAccessAuditInput(recordedAccess[0])).toEqual({
        action: 'auth.access_unauthenticated',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: route,
        metadata: { method: 'GET' },
      });
    });

    it('attributes the read to nobody, because nobody was identified', async () => {
      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(200);

      const row = toAdminAccessAuditInput(recordedAccess[0]);
      expect(row.metadata.userPrincipalName).toBeUndefined();
      expect(row.metadata.tenantId).toBeUndefined();
      expect(row.metadata.grantedRoles).toBeUndefined();
    });
  });

  it('never consults a token verifier, because the flag is what decides', async () => {
    // The guard is wired with a null verifier here, exactly as the real factory leaves it when the
    // flag is off. Reaching the route at all proves the flag short-circuits before any
    // verification is attempted, rather than the request surviving a failed one.
    const guard = app!.get(AzureJwtGuard);

    expect(guard).toBeInstanceOf(AzureJwtGuard);
    await request(app!.getHttpServer())
      .get('/v1/onboardings')
      .set('Authorization', 'Bearer eyJhbGciOiJub25lIn0.e30.')
      .expect(200);
  });
});
