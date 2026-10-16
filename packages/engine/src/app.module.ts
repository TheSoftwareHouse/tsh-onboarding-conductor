import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppMode, validateConfig } from './config/app.config';
import { AgreementsModule } from './agreements/agreements.module';
import { AuditModule } from './audit/audit.module';
import { EncryptionModule } from './encryption/encryption.module';
import { HealthModule } from './health/health.module';
import { OnboardingsModule } from './onboardings/onboardings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` only: `.env.dist` is the sample, never a fallback, so a start without a `.env` fails
      // validation instead of booting on the sample's values.
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
      validate: validateConfig,
    }),
    // EncryptionModule must initialise before any module that touches `OnboardingEntity`, so the
    // encryption registry is populated before the first entity operation can run.
    EncryptionModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        migrationsRun: configService.getOrThrow<AppMode>('MODE') !== AppMode.WORKER_ONLY,
        synchronize: false,
        migrations: [join(__dirname, 'database', 'migrations', '*.[tj]s')],
      }),
    }),
    CqrsModule.forRoot(),
    HealthModule,
    AuditModule,
    AgreementsModule,
    OnboardingsModule,
  ],
})
export class AppModule {}
