import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AdminAccessAuditAdapter } from '../audit/admin-access-audit.adapter';
import { AuditModule } from '../audit/audit.module';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { ADMIN_ACCESS_AUDIT } from './admin-access-audit.port';
import { AuthModule } from './auth.module';
import { AzureJwtGuard } from './azure-jwt.guard';

/**
 * The guard writes to the audit log and the audit endpoint sits behind the guard, so the two
 * modules import each other. That cycle type-checks either way and only shows up as a failure to
 * boot, which no other spec here would reach: the e2e suite stands up its own module with the
 * providers supplied by hand. This compiles the real modules instead.
 */
/** Stands in for `TypeOrmModule.forRoot`, which is what normally publishes `DataSource`. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

describe('AuthModule and AuditModule wiring', () => {
  async function compileRealModules() {
    return Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ADMIN_AUTH_ENABLED: false })],
        }),
        StubDataSourceModule,
        AuthModule,
        AuditModule,
      ],
    })
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({})
      .compile();
  }

  it('resolves the guard with its audit port despite the module cycle', async () => {
    const moduleRef = await compileRealModules();

    expect(moduleRef.get(AzureJwtGuard, { strict: false })).toBeInstanceOf(AzureJwtGuard);
    expect(moduleRef.get(ADMIN_ACCESS_AUDIT, { strict: false })).toBeInstanceOf(
      AdminAccessAuditAdapter,
    );

    await moduleRef.close();
  });

  it('gives the guard a working audit port rather than an unresolved placeholder', async () => {
    // A cycle resolved in the wrong order yields an object whose own dependencies are undefined,
    // which only surfaces on the first request. Calling through catches that here instead.
    const moduleRef = await compileRealModules();
    const adapter = moduleRef.get<AdminAccessAuditAdapter>(ADMIN_ACCESS_AUDIT, { strict: false });

    await expect(
      adapter.record({
        outcome: 'unauthenticated',
        endpoint: { method: 'GET', path: '/v1/onboardings' },
      }),
    ).rejects.toThrow(/transaction is not a function/);

    await moduleRef.close();
  });
});
