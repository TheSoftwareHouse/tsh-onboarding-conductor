import { Module } from '@nestjs/common';
import { DemoOnboardingsController } from './demo-onboardings.controller';
import { DemoOnboardingsService } from './demo-onboardings.service';
import { EngineClient } from '../engine/engine.client';
import { DemoBffAppConfig, loadAppConfig } from '../config/app.config';

@Module({
  controllers: [DemoOnboardingsController],
  providers: [
    {
      provide: EngineClient,
      useFactory: (config: DemoBffAppConfig) => new EngineClient(config),
      inject: ['DEMO_BFF_APP_CONFIG'],
    },
    {
      provide: 'DEMO_BFF_APP_CONFIG',
      useFactory: () => loadAppConfig(process.env),
    },
    {
      provide: DemoOnboardingsService,
      useFactory: (engineClient: EngineClient, config: DemoBffAppConfig) =>
        new DemoOnboardingsService(engineClient, config),
      inject: [EngineClient, 'DEMO_BFF_APP_CONFIG'],
    },
  ],
})
export class DemoOnboardingsModule {}
