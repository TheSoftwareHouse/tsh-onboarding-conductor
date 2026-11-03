import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';
import { AuthModule } from './auth/auth.module';
import { validateConfig } from './config/mcp.config';
import { HealthModule } from './health/health.module';
import { TransportModule } from './transport/transport.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // `.env` only: `.env.dist` is the sample, never a fallback, so a start without a `.env` fails
      // validation instead of booting on the sample's values.
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
      validate: validateConfig,
    }),
    HealthModule,
    AuthModule,
    TransportModule,
  ],
})
export class AppModule {}
