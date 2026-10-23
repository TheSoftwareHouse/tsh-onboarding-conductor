import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { join } from 'path';

import { BankDataPusher } from './bnpl/bank-data-pusher';
import { BnplController } from './bnpl/bnpl.controller';
import { BnplService } from './bnpl/bnpl.service';
import { BnplSessionStore } from './bnpl/bnpl-session.store';
import { StateWaiter } from './bnpl/state-waiter';
import { validateConfig } from './config/app.config';
import { EngineClient } from './engine/engine.client';
import { HealthController } from './health/health.controller';
import { LeanLinkService } from './lean/lean-link.service';
import { PersonaService } from './personas/persona.service';
import { EngineWebhookController } from './webhooks/engine-webhook.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [join(process.cwd(), '.env'), join(process.cwd(), '../../.env')],
      validate: validateConfig,
    }),
  ],
  controllers: [BnplController, EngineWebhookController, HealthController],
  providers: [
    EngineClient,
    BnplService,
    BnplSessionStore,
    StateWaiter,
    PersonaService,
    LeanLinkService,
    BankDataPusher,
  ],
  exports: [EngineClient],
})
export class AppModule {}
