import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DemoOnboardingsModule } from './onboarding/demo-onboardings.module';

@Module({
  imports: [HealthModule, DemoOnboardingsModule],
})
export class AppModule {}
