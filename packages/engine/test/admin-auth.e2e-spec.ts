import 'reflect-metadata';
import { Controller, Get, Module, Post, UseGuards } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import {
  createLocalJWKSet,
  errors,
  exportJWK,
  exportSPKI,
  generateKeyPair,
  SignJWT,
  UnsecuredJWT,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';
import { startE2eServer } from './e2e-server';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';
const KEY_ID = 'test-signing-key';
const OPERATOR_OBJECT_ID = '9f3c0000-0000-0000-0000-00000000000a';
const OPERATOR_UPN = 'anna.kowalska@tsh.io';
const PANEL_ORIGIN = 'http://localhost:5173';

process.env.NODE_ENV = 'test';
process.env.MODE = 'api-only';
process.env.PORT = '3002';
process.env.DATABASE_URL = 'postgres://user:pass@localhost:5432/db';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.STORAGE_DRIVER = 's3';
process.env.STORAGE_S3_BUCKET = 'orchestrator-files';
process.env.STORAGE_S3_REGION = 'us-east-1';
process.env.STORAGE_S3_ENDPOINT = 'http://127.0.0.1:3900';
process.env.STORAGE_S3_FORCE_PATH_STYLE = 'true';
process.env.STORAGE_S3_ACCESS_KEY_ID = 'onboardingdev';
process.env.STORAGE_S3_SECRET_ACCESS_KEY = 'onboardingdevsecret0123456789';
process.env.ADMIN_PANEL_ORIGIN = PANEL_ORIGIN;
process.env.ADMIN_AUTH_ENABLED = 'true';
process.env.AZURE_TENANT_ID = TENANT_ID;
process.env.AZURE_API_AUDIENCE = AUDIENCE;
process.env.ADMIN_REQUIRED_ROLES = 'admin';

import { createApp } from '../src/main';
import { validateConfig } from '../src/config/app.config';
import {
  ADMIN_ACCESS_AUDIT,
  type AdminAccessAuditEvent,
  type AdminAccessAuditPort,
} from '../src/auth/admin-access-audit.port';
import {
  ADMIN_TOKEN_VERIFIER,
  type AdminTokenVerifierPort,
} from '../src/auth/admin-token-verifier.port';
import { toAdminAccessAuditInput } from '../src/audit/admin-access-audit.adapter';
import { AzureJwtGuard } from '../src/auth/azure-jwt.guard';
import { AzureTokenVerifier, buildEntraIssuer } from '../src/auth/azure-token-verifier';
import { AuditController } from '../src/audit/audit.controller';
import { HealthController } from '../src/health/health.controller';
import { OnboardingsController } from '../src/onboardings/onboardings.controller';
import { WebhookController } from '../src/webhook/webhook.controller';

/**
 * The engine's real verifier, pointed at a locally generated key set instead of Entra's JWKS,
 * so the whole signature/issuer/audience/expiry path runs without a network call.
 */
let localVerifier: AzureTokenVerifier;
let privateKey: KeyLike;
let publicKeySpki: string;

/**
 * Stands in for the audit adapter so the suite can assert the trail without a database. Events
 * are translated through the real mapper, so what is asserted is the row that would be written.
 */
const recordedAccess: AdminAccessAuditEvent[] = [];

/** Set by the one test that needs the audit write to fail. */
let accessAuditFailure: Error | null = null;

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
      provide: ADMIN_ACCESS_AUDIT,
      useFactory: (): AdminAccessAuditPort => ({
        record: (event) => {
          recordedAccess.push(event);

          return accessAuditFailure === null
            ? Promise.resolve()
            : Promise.reject(accessAuditFailure);
        },
      }),
    },
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
    oid: OPERATOR_OBJECT_ID,
    preferred_username: OPERATOR_UPN,
    tid: TENANT_ID,
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
    publicKeySpki = await exportSPKI(keyPair.publicKey);

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
    await startE2eServer(app);
  });

  afterAll(async () => {
    await app?.close();
  });

  beforeEach(() => {
    recordedAccess.length = 0;
    accessAuditFailure = null;
  });

  /** The audit row the engine would have written for the single decision just made. */
  function recordedAuditRow() {
    expect(recordedAccess).toHaveLength(1);

    return toAdminAccessAuditInput(recordedAccess[0]);
  }

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

    it.each([['bearer'], ['BEARER'], ['BeArEr']])(
      'accepts the %s scheme, which RFC 7235 makes case-insensitive',
      async (scheme) => {
        const token = await signToken();

        await request(app!.getHttpServer())
          .get(route)
          .set('Authorization', `${scheme} ${token}`)
          .expect(200);
      },
    );

    it('answers 401 for a header that names no scheme at all', async () => {
      const token = await signToken();

      await request(app!.getHttpServer()).get(route).set('Authorization', token).expect(401);
    });

    describe('algorithm confusion', () => {
      it('answers 401 for an unsecured alg=none token', async () => {
        const token = new UnsecuredJWT({ scp: 'Onboardings.Read', roles: ['admin'] })
          .setSubject('attacker')
          .setIssuer(buildEntraIssuer(TENANT_ID))
          .setAudience(AUDIENCE)
          .setIssuedAt()
          .setExpirationTime('5m')
          .encode();

        await request(app!.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      });

      it('answers 401, not 200, for an HS256 token signed with the public key', async () => {
        // The public key is public. If HS256 were accepted this token would be a valid admin
        // credential mintable by anyone who fetched the JWKS.
        const token = await new SignJWT({ scp: 'Onboardings.Read', roles: ['admin'] })
          .setProtectedHeader({ alg: 'HS256', kid: KEY_ID })
          .setSubject('attacker')
          .setIssuer(buildEntraIssuer(TENANT_ID))
          .setAudience(AUDIENCE)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(new TextEncoder().encode(publicKeySpki));

        await request(app!.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      });

      it('answers 401, not 503, so a caller cannot fake an outage with a bad algorithm', async () => {
        const token = await new SignJWT({ roles: ['admin'] })
          .setProtectedHeader({ alg: 'PS256', kid: KEY_ID })
          .setIssuer(buildEntraIssuer(TENANT_ID))
          .setAudience(AUDIENCE)
          .setExpirationTime('5m')
          .sign(privateKey);

        await request(app!.getHttpServer())
          .get(route)
          .set('Authorization', `Bearer ${token}`)
          .expect(401);
      });
    });

    it('serves the read even when the audit row cannot be written', async () => {
      // Best effort by design: a database outage must not take the admin endpoints down with it.
      accessAuditFailure = new Error('connection terminated');
      const token = await signToken();

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(recordedAccess).toHaveLength(1);
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

  describe.each(adminRoutes)('%s audit trail', (route) => {
    it('records the operator behind a successful read', async () => {
      const token = await signToken();

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      expect(recordedAuditRow()).toEqual({
        action: 'auth.access_granted',
        actorType: 'operator',
        actorId: OPERATOR_OBJECT_ID,
        resourceId: route,
        metadata: {
          method: 'GET',
          tenantId: TENANT_ID,
          userPrincipalName: OPERATOR_UPN,
          grantedRoles: ['admin'],
        },
      });
    });

    it('records a missing credential as an anonymous refusal', async () => {
      await request(app!.getHttpServer()).get(route).expect(401);

      expect(recordedAuditRow()).toEqual({
        action: 'auth.token_rejected',
        actorType: 'anonymous',
        actorId: 'unknown',
        resourceId: route,
        metadata: { method: 'GET', reason: 'Missing bearer access token' },
      });
    });

    it('records which token a rejection was about, so a bad tenant is distinguishable', async () => {
      const otherTenant = '99999999-9999-9999-9999-999999999999';
      const token = await signToken({ issuer: buildEntraIssuer(otherTenant) });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(401);

      const row = recordedAuditRow();
      expect(row.action).toBe('auth.token_rejected');
      expect(row.actorType).toBe('anonymous');
      expect(row.metadata.tokenIssuer).toBe(buildEntraIssuer(otherTenant));
      expect(row.metadata.tokenAudience).toBe(AUDIENCE);
      expect(row.metadata.reason).toMatch(/iss/);
    });

    it('records a role refusal against the named operator who was turned away', async () => {
      const token = await signToken({ roles: ['compliance', 'auditor'] });

      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', `Bearer ${token}`)
        .expect(403);

      expect(recordedAuditRow()).toEqual({
        action: 'auth.role_missing',
        actorType: 'operator',
        actorId: OPERATOR_OBJECT_ID,
        resourceId: route,
        metadata: {
          method: 'GET',
          tenantId: TENANT_ID,
          userPrincipalName: OPERATOR_UPN,
          grantedRoles: ['compliance', 'auditor'],
          requiredRoles: ['admin'],
        },
      });
    });

    it('records an unreachable key set separately from a rejected credential', async () => {
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

      const row = recordedAuditRow();
      expect(row.action).toBe('auth.verification_unavailable');
      expect(row.actorType).toBe('anonymous');
      expect(row.metadata.reason).toMatch(/timed out/i);
    });

    it('never attributes a refused request to a named operator', async () => {
      await request(app!.getHttpServer())
        .get(route)
        .set('Authorization', 'Basic dXNlcjpwYXNz')
        .expect(401);

      const row = recordedAuditRow();
      expect(row.metadata.userPrincipalName).toBeUndefined();
      expect(row.metadata.tenantId).toBeUndefined();
      expect(row.actorId).toBe('unknown');
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

  /**
   * The suite above drives a stand-in controller, so this enumerates the engine's entire real
   * route surface and states, handler by handler, which side of the trust boundary it sits on.
   * Adding a route without deciding that question fails here rather than shipping.
   */
  describe('authorization surface of the real controllers', () => {
    function guardsOf(handler: object): unknown[] {
      return (Reflect.getMetadata('__guards__', handler) as unknown[] | undefined) ?? [];
    }

    const guarded: ReadonlyArray<[string, object]> = [
      ['OnboardingsController.list', OnboardingsController.prototype.list],
      // The CSV download of the same operator list, so it shares the list's guard.
      ['OnboardingsController.export', OnboardingsController.prototype.export],
      // Both serve the admin panel's onboarding detail view, so they belong to the operator read
      // surface rather than to the end user's own flow that `getState` answers.
      ['OnboardingsController.getForAdmin', OnboardingsController.prototype.getForAdmin],
      ['OnboardingsController.listTransitions', OnboardingsController.prototype.listTransitions],
      // Reading and linking an agreement are operator actions on someone else's onboarding, so
      // they join the admin surface rather than the end user's own flow.
      ['OnboardingsController.listAgreements', OnboardingsController.prototype.listAgreements],
      ['OnboardingsController.linkAgreement', OnboardingsController.prototype.linkAgreement],
      // An operator reads a parked provider's verdict back on someone else's onboarding, so it sits
      // with the other admin actions.
      [
        'OnboardingsController.reconcilePendingConnector',
        OnboardingsController.prototype.reconcilePendingConnector,
      ],
      ['AuditController.list', AuditController.prototype.list],
    ];

    const unguarded: ReadonlyArray<[string, object]> = [
      ['OnboardingsController.start', OnboardingsController.prototype.start],
      ['OnboardingsController.submit', OnboardingsController.prototype.submit],
      [
        'OnboardingsController.reserveDocumentUpload',
        OnboardingsController.prototype.reserveDocumentUpload,
      ],
      [
        'OnboardingsController.completeDocumentUpload',
        OnboardingsController.prototype.completeDocumentUpload,
      ],
      // Reached by an operator, not by the end user whose flow the other POST handlers serve.
      // It is unauthenticated today; this records that as a decision rather than an oversight.
      ['OnboardingsController.review', OnboardingsController.prototype.review],
      // Serves the end user's own onboarding flow through the BFF, which carries no Entra
      // identity, so it stays public alongside the POST handlers above rather than joining the
      // admin read surface below.
      ['OnboardingsController.getState', OnboardingsController.prototype.getState],
      // Accepting is the end user ticking the box in their own flow, which carries no Entra
      // identity, so it stays public alongside `submit` and `getState`.
      ['OnboardingsController.acceptAgreement', OnboardingsController.prototype.acceptAgreement],
      ['WebhookController.receive', WebhookController.prototype.receive],
      ['HealthController.getLiveHealth', HealthController.prototype.getLiveHealth],
    ];

    it.each(guarded)('%s is behind the Entra guard', (_name, handler) => {
      expect(guardsOf(handler)).toContain(AzureJwtGuard);
    });

    it.each(unguarded)('%s is reachable without a token', (_name, handler) => {
      expect(guardsOf(handler)).not.toContain(AzureJwtGuard);
    });

    it('covers every handler on the controllers that expose admin data', () => {
      // Keeps the two lists above honest: a new route on either controller is unlisted until
      // someone classifies it.
      const classified = new Set([...guarded, ...unguarded].map(([, handler]) => handler));
      const declared = [OnboardingsController, AuditController]
        .flatMap((controller) =>
          Object.getOwnPropertyNames(controller.prototype)
            .filter((name) => name !== 'constructor')
            .map((name) => (controller.prototype as unknown as Record<string, unknown>)[name]),
        )
        .filter(
          (member): member is (...args: unknown[]) => unknown => typeof member === 'function',
        );

      expect(declared.filter((handler) => !classified.has(handler))).toEqual([]);
    });
  });
});
