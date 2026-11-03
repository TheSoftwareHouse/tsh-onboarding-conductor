import { Module } from '@nestjs/common';
import { ClassificationModule } from '../../classification/classification.module';
import { ConfirmationModule } from '../../confirmation/confirmation.module';
import { EngineModule } from '../../engine/engine.module';
import { LimitsModule } from '../../limits/limits.module';
import { MaskingModule } from '../../masking/masking.module';
import { FindOnboardingsTool } from './find-onboardings.tool';
import { GetOnboardingTimelineTool } from './get-onboarding-timeline.tool';
import { GetOnboardingTool } from './get-onboarding.tool';
import { ReconcilePendingConnectorTool } from './reconcile-pending-connector.tool';

@Module({
  imports: [EngineModule, MaskingModule, ClassificationModule, LimitsModule, ConfirmationModule],
  providers: [
    FindOnboardingsTool,
    GetOnboardingTool,
    GetOnboardingTimelineTool,
    ReconcilePendingConnectorTool,
  ],
})
export class OnboardingsToolsModule {}
