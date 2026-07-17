import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: null;
}

export interface SubmitOnboardingResponse {
  appliedStep: string;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
}

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponse> {
    const workflow = this.workflowRegistryService.getById(dto.workflowId, 1);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();
    await this.dataSource.transaction((manager) =>
      this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        expiresAt: null,
        completedAt: null,
      }),
    );

    return {
      onboardingId,
      status: initialState.status,
      currentStep: initialState.currentStep,
      expiresAt: null,
    };
  }

  async submit(onboardingId: string, submittedData: unknown): Promise<SubmitOnboardingResponse> {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new NotFoundException({
          code: 'ONBOARDING_NOT_FOUND',
          message: 'ONBOARDING_NOT_FOUND',
        });
      }

      if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
        throw new ConflictException({
          code: 'ONBOARDING_COMPLETED',
          message: 'ONBOARDING_COMPLETED',
        });
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const result = workflow.evaluate({
        currentStep: onboarding.currentStep,
        submittedData,
      });

      if (!result) {
        throw new BadRequestException({
          code: 'INVALID_STEP_DATA',
          message: 'INVALID_STEP_DATA',
        });
      }

      onboarding.context = {
        ...onboarding.context,
        ...result.acceptedData,
      };
      onboarding.status = result.terminal ? 'approved' : result.status;
      onboarding.currentStep = result.terminal ? null : result.currentStep;
      onboarding.completedAt = result.terminal ? new Date() : null;

      await this.onboardingsRepository.saveLocked(manager, onboarding);

      return {
        appliedStep: result.appliedStep,
        status: onboarding.status as 'awaiting_user' | 'approved',
        currentStep: onboarding.currentStep,
      };
    });
  }
}
