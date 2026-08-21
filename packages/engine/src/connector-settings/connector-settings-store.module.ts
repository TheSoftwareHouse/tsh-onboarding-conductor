import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConnectorSettingsCipher } from './connector-settings.cipher';
import { ConnectorSettingsStore } from './connector-settings.store';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';

/**
 * The runtime half of the feature: what a connector adapter needs to read its own settings, and
 * nothing else. Kept apart from {@link ConnectorSettingsModule} so that importing it — as
 * `ConnectorsModule` does — pulls in no admin controller and no authentication.
 */
@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([ConnectorSettingEntity])],
  providers: [ConnectorSettingsCipher, ConnectorSettingsStore],
  exports: [ConnectorSettingsCipher, ConnectorSettingsStore, TypeOrmModule],
})
export class ConnectorSettingsStoreModule {}
