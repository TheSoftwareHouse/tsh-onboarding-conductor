import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [WorkflowsModule],
  controllers: [OnboardingsController],
  providers: [OnboardingsService],
})
export class OnboardingsModule {}
