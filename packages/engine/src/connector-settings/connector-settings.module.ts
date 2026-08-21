import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { ConnectorSettingsStoreModule } from './connector-settings-store.module';
import { ConnectorSettingsController } from './connector-settings.controller';
import { ConnectorSettingsService } from './connector-settings.service';

/**
 * The admin surface: reading and editing what an operator may configure. Deliberately knows
 * nothing about the adapter registry — the settings a connector can take are declared in
 * `connector-setting-declarations.ts`, which is what keeps this module and `ConnectorsModule`
 * from depending on each other.
 */
@Module({
  // `@UseGuards(AzureJwtGuard)` instantiates the guard in the module that declares the
  // controller, so this module needs everything the guard needs: AuthModule for the token
  // verifier and AuditModule for the port it records access decisions through.
  imports: [AuditModule, AuthModule, ConfigModule, ConnectorSettingsStoreModule],
  controllers: [ConnectorSettingsController],
  providers: [ConnectorSettingsService],
})
export class ConnectorSettingsModule {}
