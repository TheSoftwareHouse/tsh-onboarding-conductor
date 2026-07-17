import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WorkflowsModule } from '../workflows/workflows.module';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingEntity } from './onboarding.entity';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [WorkflowsModule, TypeOrmModule.forFeature([OnboardingEntity])],
  controllers: [OnboardingsController],
  providers: [OnboardingsRepository, OnboardingsService],
})
export class OnboardingsModule {}
