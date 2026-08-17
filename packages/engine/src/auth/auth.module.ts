import { Module, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { ADMIN_TOKEN_VERIFIER, type AdminTokenVerifierPort } from './admin-token-verifier.port';
import { AzureJwtGuard } from './azure-jwt.guard';
import { AzureTokenVerifier } from './azure-token-verifier';

@Module({
  // Deferred both ways: the guard records access decisions in the audit log, and the audit
  // endpoint is itself behind the guard.
  imports: [forwardRef(() => AuditModule)],
  providers: [
    {
      provide: ADMIN_TOKEN_VERIFIER,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): AdminTokenVerifierPort | null => {
        // Configuration validation already guarantees both values whenever admin auth is on,
        // so a null verifier only ever means the local escape hatch is in use.
        if (configService.get<boolean>('ADMIN_AUTH_ENABLED') !== true) {
          return null;
        }

        return new AzureTokenVerifier({
          tenantId: configService.getOrThrow<string>('AZURE_TENANT_ID'),
          audience: configService.getOrThrow<string>('AZURE_API_AUDIENCE'),
        });
      },
    },
    AzureJwtGuard,
  ],
  exports: [ADMIN_TOKEN_VERIFIER, AzureJwtGuard],
})
export class AuthModule {}
