import { Module } from '@nestjs/common';
import { ClassificationModule } from '../../classification/classification.module';
import { EngineModule } from '../../engine/engine.module';
import { LimitsModule } from '../../limits/limits.module';
import { MaskingModule } from '../../masking/masking.module';
import { ConnectorHealthTool } from './connector-health.tool';
import { OnboardingExportRows } from './onboarding-export-rows';
import { OnboardingFunnelTool } from './onboarding-funnel.tool';
import { OnboardingStatsTool } from './onboarding-stats.tool';
import { ReviewQueueTool } from './review-queue.tool';

@Module({
  imports: [EngineModule, MaskingModule, ClassificationModule, LimitsModule],
  providers: [
    OnboardingExportRows,
    OnboardingStatsTool,
    OnboardingFunnelTool,
    ConnectorHealthTool,
    ReviewQueueTool,
  ],
})
export class AnalyticsToolsModule {}
