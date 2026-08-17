import 'reflect-metadata';
import path from 'node:path';
import { Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';
const KEY_ID = 'test-signing-key';
const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3002';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.STORAGE_DRIVER = 's3';
process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:9000';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'minioadmin';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'minioadmin';
process.env.WORKFLOWS_DIR = path.resolve(__dirname, '..', '..', '..', 'workflows');
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
process.env.SENDGRID_API_KEY = 'SG.test';
process.env.SENDGRID_FROM = 'no-reply@example.com';
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.AZURE_TENANT_ID = TENANT_ID;
process.env.AZURE_API_AUDIENCE = AUDIENCE;
process.env.ADMIN_REQUIRED_ROLES = 'admin';

import { createApp } from '../src/main';
import { validateConfig } from '../src/config/app.config';
import {
  ADMIN_TOKEN_VERIFIER,
  type AdminTokenVerifierPort,
} from '../src/auth/admin-token-verifier.port';
import { AzureJwtGuard } from '../src/auth/azure-jwt.guard';
import { AzureTokenVerifier, buildEntraIssuer } from '../src/auth/azure-token-verifier';
import { AuditController } from '../src/audit/audit.controller';
import { OnboardingsController } from '../src/onboardings/onboardings.controller';

/**
 * The engine's real verifier, pointed at a locally generated key set instead of Entra's JWKS,
 * so the whole signature/issuer/audience/expiry path runs without a network call.
 */
let localVerifier: AzureTokenVerifier;
let privateKey: KeyLike;

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

  @Post('/v1/onboardings')
  startOnboarding() {
    return { onboardingId: 'public-route' };
  }

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
  controllers: [TestAdminController],
  providers: [
    {
      provide: ADMIN_TOKEN_VERIFIER,
      // Delegates on every call rather than capturing the verifier at bootstrap, so a single test
      // can stand a broken one in its place and put the working one back afterwards.
      useFactory: (): AdminTokenVerifierPort => ({
        verify: (token) => localVerifier.verify(token),
      }),
    },
    AzureJwtGuard,
  ],
})
class TestAppModule {}

async function signToken(
  claims: {
    issuer?: string;
    audience?: string;
    expiresIn?: string;
    roles?: string[] | undefined;
  } = {},
): Promise<string> {
  return new SignJWT({
    scp: 'Onboardings.Read',
    ...('roles' in claims ? { roles: claims.roles } : { roles: ['admin'] }),
  })
    .setProtectedHeader({ alg: 'RS256', kid: KEY_ID })
    .setSubject('operator-object-id')
    .setIssuer(claims.issuer ?? buildEntraIssuer(TENANT_ID))
    .setAudience(claims.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(claims.expiresIn ?? '5m')
    .sign(privateKey);
}

describe('Admin endpoint authentication (e2e)', () => {
  const adminRoutes = ['/v1/onboardings', '/v1/admin/audit'];
  let app: NestExpressApplication | undefined;

  beforeAll(async () => {
    const keyPair = await generateKeyPair('RS256', { extractable: true });
    privateKey = keyPair.privateKey;

    const publicJwk = await exportJWK(keyPair.publicKey);
    const getKey: JWTVerifyGetKey = createLocalJWKSet({
      keys: [{ ...publicJwk, kid: KEY_ID, alg: 'RS256', use: 'sig' }],
    });

    localVerifier = new AzureTokenVerifier({
      tenantId: TENANT_ID,
      audience: AUDIENCE,
      getKey,
    });

    const createdApp = await createApp(TestAppModule);
    app = createdApp.app;
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  describe.each(adminRoutes)('%s', (route) => {
    it('answers 401 without a token', async () => {
      await request(app!.getHttpServer()).get(route).expect(401);
    });

    it('answers 401 for a malformed Authorization header', async () => {
      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);
    });

    it('answers 401 for a token from another tenant', async () => {
      const token = await signToken({
        issuer: buildEntraIssuer('99999999-9999-9999-9999-999999999999'),
      });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('answers 401 for a token minted for another API', async () => {
      const token = await signToken({ audience: 'api://some-other-service' });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('answers 401 for an expired token', async () => {
      const token = await signToken({ expiresIn: '-1m' });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('answers 403 for a verifiable token from an account with no assigned app role', async () => {
      const token = await signToken({ roles: undefined });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('answers 403 for a token carrying only the other app roles', async () => {
      const token = await signToken({ roles: ['compliance', 'auditor'] });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);
    });

    it('answers 200 for a valid token from an admin', async () => {
      const token = await signToken();

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    });

    it('answers 503, not 401, when Entra’s key set cannot be reached', async () => {
      // A perfectly good token, but the engine cannot fetch the keys to check it. Answering 401
      // would tell the operator their session is bad and send them to sign in again for nothing.
      const token = await signToken();
      const unreachable = new AzureTokenVerifier({
        tenantId: TENANT_ID,
        audience: AUDIENCE,
        getKey: () => Promise.reject(new errors.JWKSTimeout()),
      });
      const restore = localVerifier;
      localVerifier = unreachable;

      try {
        await request(app!.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(503);
      } finally {
        localVerifier = restore;
      }
    });
  });

  it('leaves the public onboarding start endpoint unauthenticated', async () => {
    await request(app!.getHttpServer()).post('/v1/onboardings').expect(201);
  });

  it('leaves the health endpoint unauthenticated', async () => {
    await request(app!.getHttpServer()).get('/v1/health/live').expect(200);
  });

  it('allows the panel origin to preflight an Authorization-bearing admin request', async () => {
    const response = await request(app!.getHttpServer())
      .options('/v1/onboardings')
      .set('Origin', PANEL_ORIGIN)
      .set('Access-Control-Request-Method', 'GET')
      .set('Access-Control-Request-Headers', 'authorization')
      .send();

    expect([200, 204]).toContain(response.status);
    expect(response.headers['access-control-allow-origin']).toBe(PANEL_ORIGIN);
    expect(response.headers['access-control-allow-headers']?.toLowerCase()).toContain(
      'authorization',
    );
  });

  it('guards the real admin controllers, not just the routes exercised above', () => {
    expect(Reflect.getMetadata('__guards__', OnboardingsController.prototype.list)).toContain(
      AzureJwtGuard,
    );
    expect(Reflect.getMetadata('__guards__', AuditController.prototype.list)).toContain(
      AzureJwtGuard,
    );
  });
});
