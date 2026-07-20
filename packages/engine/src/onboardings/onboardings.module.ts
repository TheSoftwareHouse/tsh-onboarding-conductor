import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OnboardingEntity } from './entity/onboarding.entity';
import { AdminOnboardingsController } from './admin-onboardings.controller';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [WorkflowsModule, TypeOrmModule.forFeature([OnboardingEntity])],
  controllers: [OnboardingsController, AdminOnboardingsController],
  providers: [OnboardingsRepository, OnboardingsService],
})
export class OnboardingsModule {}
