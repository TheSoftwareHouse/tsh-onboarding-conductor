import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingStateResponseDto } from './dto/onboarding-state.response.dto';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingsRepository } from './onboardings.repository';

@Injectable()
export class OnboardingStateService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
  ) {}

  async getState(onboardingId: string): Promise<OnboardingStateResponseDto> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    const workflow = await this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );
    const step = workflow.findStepDescription(onboarding.currentStep, onboarding.context);

    return {
      onboardingId: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      terminal: step === undefined,
      rejectionReason: onboarding.rejectionReason,
      step: step ?? null,
    };
  }
}
