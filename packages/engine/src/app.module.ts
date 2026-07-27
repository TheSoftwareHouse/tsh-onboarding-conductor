import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CqrsModule } from '@nestjs/cqrs';
import { TypeOrmModule } from '@nestjs/typeorm';
import { join } from 'path';
import { validateConfig } from './config/app.config';
import { AuditModule } from './audit/audit.module';
import { HealthModule } from './health/health.module';
import { OnboardingsModule } from './onboardings/onboardings.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        join(process.cwd(), '.env'),
        join(process.cwd(), '../../.env'),
        join(process.cwd(), '../../.env.dist'),
      ],
      validate: validateConfig,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'postgres',
        url: configService.getOrThrow<string>('DATABASE_URL'),
        autoLoadEntities: true,
        migrationsRun: true,
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
