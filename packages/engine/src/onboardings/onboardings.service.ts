import { Injectable, NotFoundException } from '@nestjs/common';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { CreateOnboardingDto } from './create-onboarding.dto';
import { generateUuidV7 } from '../utils/uuid.util';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: 'approved';
  currentStep: null;
  expiresAt: null;
}

@Injectable()
export class OnboardingsService {
  constructor(private readonly workflowRegistry: WorkflowRegistryService) {}

  start(dto: CreateOnboardingDto): CreateOnboardingResponse {
    const workflow = this.workflowRegistry.findById(dto.flowId);

    if (!workflow) {
      throw new NotFoundException({
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      });
    }

    if (workflow.steps.length !== 0) {
      throw new Error('Only empty workflows are supported');
    }

    return {
      onboardingId: generateUuidV7(),
      status: 'approved',
      currentStep: null,
      expiresAt: null,
    };
  }
}
