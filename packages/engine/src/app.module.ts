import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { AppMode, validateConfig } from './config/app.config';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { OnboardingsModule } from './onboardings/onboardings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env.dist` is the sample file, not a fallback. It used to sit at the end of this list,
      // which meant any host with the repository checked out silently inherited its development
      // values — including FIXTURE_WORKFLOWS_ENABLED and SANDBOX_CONNECTORS_ENABLED — even when
      // the deployment supplied none of them. Copy it to `.env` to use it.
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
      validate: validateConfig,
    }),
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
    OnboardingsModule,
  ],
})
export class AppModule {}
