import {
  Inject,
  Module,
  Optional,
  forwardRef,
  type MiddlewareConsumer,
  type NestModule,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { AuditModule } from '../audit/audit.module';
import {
  ADMIN_SESSION_VERIFIER,
  type AdminSessionVerifierPort,
} from './admin-session-verifier.port';
import { AuthMailer } from './auth-mailer';
import { AdminSessionGuard } from './admin-session.guard';
import { BetterAuthSessionVerifier } from './better-auth/better-auth-session.verifier';
import { createAuthPool, createBetterAuth } from './better-auth/better-auth.factory';
import { BetterAuthMiddleware } from './better-auth/better-auth.middleware';
import { BETTER_AUTH, BETTER_AUTH_POOL } from './better-auth/better-auth.tokens';
import type { BetterAuthInstance } from './better-auth/load-better-auth';
import { SuperadminSeedService } from './superadmin-seed.service';

const isAdminAuthEnabled = (configService: ConfigService): boolean =>
  configService.get<boolean>('ADMIN_AUTH_ENABLED') === true;

@Module({
  // Deferred both ways: the guard records access decisions in the audit log, and the audit
  // endpoint is itself behind the guard.
  imports: [forwardRef(() => AuditModule)],
  providers: [
    {
      provide: BETTER_AUTH_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Pool | null =>
        isAdminAuthEnabled(configService) ? createAuthPool(configService) : null,
    },
    {
      provide: BETTER_AUTH,
      inject: [ConfigService, BETTER_AUTH_POOL, AuthMailer],
      useFactory: (configService: ConfigService, pool: Pool | null, mailer: AuthMailer) =>
        pool ? createBetterAuth(configService, pool, mailer) : null,
    },
    {
      provide: ADMIN_SESSION_VERIFIER,
      inject: [BETTER_AUTH],
      useFactory: (auth: BetterAuthInstance | null): AdminSessionVerifierPort | null =>
        auth ? new BetterAuthSessionVerifier(auth) : null,
    },
    AdminSessionGuard,
    BetterAuthMiddleware,
    AuthMailer,
    SuperadminSeedService,
  ],
  exports: [ADMIN_SESSION_VERIFIER, AdminSessionGuard, BETTER_AUTH],
})
export class AuthModule implements NestModule, OnModuleDestroy {
  constructor(
    private readonly configService: ConfigService,
    @Optional() @Inject(BETTER_AUTH_POOL) private readonly pool: Pool | null,
  ) {}

  configure(consumer: MiddlewareConsumer): void {
    if (!isAdminAuthEnabled(this.configService)) {
      return;
    }

    // `{*path}` also matches `/v1/auth` itself. Mounted here rather than in main.ts so the e2e
    // suites, which build the app through `Test.createTestingModule`, get the handler too.
    consumer.apply(BetterAuthMiddleware).forRoutes('v1/auth/{*path}');
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool?.end();
  }
}
