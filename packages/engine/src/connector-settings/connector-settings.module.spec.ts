import 'reflect-metadata';
import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AuditLogEntity } from '../audit/entity/audit-log.entity';
import { ConnectorSettingsController } from './connector-settings.controller';
import { ConnectorSettingsModule } from './connector-settings.module';
import { ConnectorSettingEntity } from './entity/connector-setting.entity';

/** Stands in for `TypeOrmModule.forRoot`, which is what normally publishes `DataSource`. */
@Global()
@Module({
  providers: [{ provide: DataSource, useValue: {} }],
  exports: [DataSource],
})
class StubDataSourceModule {}

/**
 * The controller is guarded, and `@UseGuards` instantiates the guard in the module that declares
 * the controller rather than in the one that provides it. Missing an import the guard needs
 * type-checks and only shows up as a failure to boot, so this compiles the real module.
 */
describe('ConnectorSettingsModule', () => {
  it('resolves the guarded controller with everything the guard needs', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          load: [() => ({ ADMIN_AUTH_ENABLED: false })],
        }),
        StubDataSourceModule,
        ConnectorSettingsModule,
      ],
    })
      .overrideProvider(getRepositoryToken(ConnectorSettingEntity))
      .useValue({})
      .overrideProvider(getRepositoryToken(AuditLogEntity))
      .useValue({})
      .compile();

    expect(moduleRef.get(ConnectorSettingsController)).toBeInstanceOf(ConnectorSettingsController);

    await moduleRef.close();
  });
});
