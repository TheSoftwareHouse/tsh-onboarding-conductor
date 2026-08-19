import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuditModule } from '../audit/audit.module';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { ADMIN_TOKEN_VERIFIER } from './admin-token-verifier.port';
import { AuthModule } from './auth.module';
import { AzureTokenVerifier } from './azure-token-verifier';
import { SsoProvider } from './sso-provider';

const TENANT_ID = '11111111-1111-1111-1111-111111111111';
const AUDIENCE = '22222222-2222-2222-2222-222222222222';

/** Stands in for `TypeOrmModule.forRoot`, which is what normally publishes `DataSource`. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

/**
 * Covers the verifier factory, which decides whether the engine has a token verifier at all. The
 * disabled branch is the local escape hatch; the enabled branch is what protects production, and
 * until now only the former was ever constructed in a test.
 */
describe('AuthModule token verifier factory', () => {
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

  it('builds a real Entra verifier when admin auth is enabled', async () => {
    const moduleRef = await compile({
      ADMIN_AUTH_ENABLED: true,
      AZURE_TENANT_ID: TENANT_ID,
      AZURE_API_AUDIENCE: AUDIENCE,
    });

    expect(moduleRef.get(ADMIN_TOKEN_VERIFIER, { strict: false })).toBeInstanceOf(
      AzureTokenVerifier,
    );

    await moduleRef.close();
  });

  it('builds the verifier the configured SSO provider asks for', async () => {
    const moduleRef = await compile({
      ADMIN_AUTH_ENABLED: true,
      ADMIN_SSO_PROVIDER: SsoProvider.AZURE,
      AZURE_TENANT_ID: TENANT_ID,
      AZURE_API_AUDIENCE: AUDIENCE,
    });

    expect(moduleRef.get(ADMIN_TOKEN_VERIFIER, { strict: false })).toBeInstanceOf(
      AzureTokenVerifier,
    );

    await moduleRef.close();
  });

  it('refuses to start on a provider it has no verifier for', async () => {
    // Config validation rejects an unknown provider first, so this only ever fires if the two
    // fall out of step. Falling back to Entra instead would accept tokens from the directory the
    // operator meant to switch away from.
    await expect(
      compile({
        ADMIN_AUTH_ENABLED: true,
        ADMIN_SSO_PROVIDER: 'google',
        AZURE_TENANT_ID: TENANT_ID,
        AZURE_API_AUDIENCE: AUDIENCE,
      }),
    ).rejects.toThrow(/ADMIN_SSO_PROVIDER/);
  });

  it('supplies no verifier when admin auth is disabled, which is what opens the guard', async () => {
    const moduleRef = await compile({ ADMIN_AUTH_ENABLED: false });

    expect(moduleRef.get(ADMIN_TOKEN_VERIFIER, { strict: false })).toBeNull();

    await moduleRef.close();
  });

  it.each([['AZURE_TENANT_ID'], ['AZURE_API_AUDIENCE']])(
    'refuses to start rather than run unguarded when %s is missing while enabled',
    async (missingKey) => {
      // Configuration validation normally catches this first. The factory asserts it again
      // because the alternative — a verifier built from undefined — would accept nothing and
      // read as an outage on every request.
      const config: Record<string, unknown> = {
        ADMIN_AUTH_ENABLED: true,
        AZURE_TENANT_ID: TENANT_ID,
        AZURE_API_AUDIENCE: AUDIENCE,
      };
      delete config[missingKey];

      await expect(compile(config)).rejects.toThrow(missingKey);
    },
  );

  it('treats a non-boolean truthy flag as disabled, matching the guard', async () => {
    // Config validation only ever hands through a real boolean, so the factory and the guard both
    // compare against `true` exactly. They must agree, or one would open while the other closed.
    const moduleRef = await compile({ ADMIN_AUTH_ENABLED: 'true' });

    expect(moduleRef.get(ADMIN_TOKEN_VERIFIER, { strict: false })).toBeNull();

    await moduleRef.close();
  });
});
