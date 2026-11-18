import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { ADMIN_SESSION_VERIFIER } from './admin-session-verifier.port';
import { AuthModule } from './auth.module';
import { BetterAuthSessionVerifier } from './better-auth/better-auth-session.verifier';
import { BetterAuthMiddleware } from './better-auth/better-auth.middleware';
import { BETTER_AUTH, BETTER_AUTH_POOL } from './better-auth/better-auth.tokens';

/** What `ADMIN_AUTH_ENABLED=true` additionally requires; `new Pool` and the instance connect lazily. */
const BETTER_AUTH_CONFIG = {
  BETTER_AUTH_SECRET: 'unit-test-better-auth-secret-0123456789',
  BETTER_AUTH_URL: 'http://localhost:3000',
  ADMIN_PANEL_ORIGIN: 'http://localhost:5173',
  ENVIRONMENT_NAME: 'test',
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://user:pass@localhost:5432/db',
};

/** Stands in for `TypeOrmModule.forRoot`, which is what normally publishes `DataSource`. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

/**
 * Covers the wiring that decides whether the engine has a session verifier at all. The disabled
 * branch is the local escape hatch; the enabled branch is what protects production.
 */
describe('AuthModule session verifier wiring', () => {
  async function compile(config: Record<string, unknown>) {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, load: [() => config] }),
        StubDataSourceModule,
        AuthModule,
        AuditModule,
      ],
    })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({})
      .compile();
  }

  it('treats a non-boolean truthy flag as disabled, matching the guard', async () => {
    // Config validation only ever hands through a real boolean, so the factory and the guard both
    // compare against `true` exactly. They must agree, or one would open while the other closed.
    const moduleRef = await compile({ ADMIN_AUTH_ENABLED: 'true' });

    expect(moduleRef.get(ADMIN_SESSION_VERIFIER, { strict: false })).toBeNull();

    await moduleRef.close();
  });

  describe('better-auth wiring', () => {
    const consumerFor = () => {
      const forRoutes = jest.fn();
      return { forRoutes, apply: jest.fn(() => ({ forRoutes })) };
    };

    it('builds the instance and mounts the middleware under /v1/auth when enabled', async () => {
      const moduleRef = await compile({
        ADMIN_AUTH_ENABLED: true,
        ...BETTER_AUTH_CONFIG,
      });
      const consumer = consumerFor();

      expect(moduleRef.get(BETTER_AUTH, { strict: false })).toBeTruthy();
      expect(moduleRef.get(BETTER_AUTH_POOL, { strict: false })).toBeInstanceOf(Pool);
      expect(moduleRef.get(ADMIN_SESSION_VERIFIER, { strict: false })).toBeInstanceOf(
        BetterAuthSessionVerifier,
      );

      moduleRef.get(AuthModule).configure(consumer as never);

      expect(consumer.apply).toHaveBeenCalledWith(BetterAuthMiddleware);
      expect(consumer.forRoutes).toHaveBeenCalledWith('v1/auth/{*path}');

      await moduleRef.close();
    });

    it('registers no instance, pool or middleware when auth is disabled', async () => {
      const moduleRef = await compile({ ADMIN_AUTH_ENABLED: false });
      const consumer = consumerFor();

      expect(moduleRef.get(BETTER_AUTH, { strict: false })).toBeNull();
      expect(moduleRef.get(BETTER_AUTH_POOL, { strict: false })).toBeNull();
      expect(moduleRef.get(ADMIN_SESSION_VERIFIER, { strict: false })).toBeNull();

      moduleRef.get(AuthModule).configure(consumer as never);

      expect(consumer.apply).not.toHaveBeenCalled();

      await moduleRef.close();
    });
  });
});
