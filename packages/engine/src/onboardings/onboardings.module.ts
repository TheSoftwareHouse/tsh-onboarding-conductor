import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RuntimeModule } from '../runtime/runtime.module';
import { OnboardingsController } from './onboardings.controller';
import { OnboardingEntity } from './onboarding.entity';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

@Module({
  imports: [RuntimeModule, TypeOrmModule.forFeature([OnboardingEntity])],
  controllers: [OnboardingsController],
  providers: [OnboardingsRepository, OnboardingsService],
})
export class OnboardingsModule {}
