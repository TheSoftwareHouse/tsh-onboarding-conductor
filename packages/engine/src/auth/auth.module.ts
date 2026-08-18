import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { ADMIN_TOKEN_VERIFIER, type AdminTokenVerifierPort } from './admin-token-verifier.port';
import { AzureJwtGuard } from './azure-jwt.guard';
import { AzureTokenVerifier } from './azure-token-verifier';
import { DEFAULT_SSO_PROVIDER, SUPPORTED_SSO_PROVIDERS, SsoProvider } from './sso-provider';

type AdminTokenVerifierFactory = (configService: ConfigService) => AdminTokenVerifierPort;

/**
 * One entry per SSO provider the engine can verify tokens from. This is the whole switching
 * seam: everything downstream sees only {@link AdminTokenVerifierPort}, so a second directory is
 * a second entry here and nothing else in the request path changes.
 */
const VERIFIER_FACTORIES: Record<SsoProvider, AdminTokenVerifierFactory> = {
  [SsoProvider.AZURE]: (configService) =>
    new AzureTokenVerifier({
      tenantId: configService.getOrThrow<string>('AZURE_TENANT_ID'),
      audience: configService.getOrThrow<string>('AZURE_API_AUDIENCE'),
    }),
};

@Module({
  // Deferred both ways: the guard records access decisions in the audit log, and the audit
  // endpoint is itself behind the guard.
  imports: [forwardRef(() => AuditModule)],
  providers: [
    {
      provide: ADMIN_TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): AdminTokenVerifierPort | null => {
        // Configuration validation already guarantees the selected provider's settings whenever
        // admin auth is on, so a null verifier only ever means the local escape hatch is in use.
        if (configService.get<boolean>('ADMIN_AUTH_ENABLED') !== true) {
          return null;
        }

        const provider =
          configService.get<SsoProvider>('ADMIN_SSO_PROVIDER') ?? DEFAULT_SSO_PROVIDER;
        // Config validation rejects an unknown provider first. Asserting it again keeps the
        // failure a refusal to start rather than an undefined verifier reaching the guard.
        const buildVerifier: AdminTokenVerifierFactory | undefined = VERIFIER_FACTORIES[provider];

        if (!buildVerifier) {
          throw new Error(
            `ADMIN_SSO_PROVIDER='${String(provider)}' is not a supported SSO provider (one of: ${SUPPORTED_SSO_PROVIDERS.join(', ')})`,
          );
        }

        return buildVerifier(configService);
      },
    },
    AzureJwtGuard,
  ],
  exports: [ADMIN_TOKEN_VERIFIER, AzureJwtGuard],
})
export class AuthModule {}
