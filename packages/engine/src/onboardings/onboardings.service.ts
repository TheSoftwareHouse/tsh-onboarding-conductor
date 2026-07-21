import { ConflictException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingJourneyStateDescriptor, OnboardingSafeHistoryItem } from '@tsh/shared';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: null;
}

export type SubmitOnboardingResponse =
  | {
      kind: 'accepted';
      appliedStep: string;
      status: 'awaiting_user' | 'approved';
      currentStep: string | null;
    }
  | {
      kind: 'rejected';
      problem: {
        type: string;
        title: string;
        status: 400;
        code: 'INVALID_STEP_DATA';
        fieldErrors: Array<{ field: string; code: string }>;
      };
    };

export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: 'awaiting_user' | 'approved';
  currentStep: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
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

  async listForAdmin(query: ListAdminOnboardingsQueryDto): Promise<AdminOnboardingSummary[]> {
    const onboardings = await this.onboardingsRepository.findForAdmin(
      this.dataSource.manager,
      query,
    );

    return onboardings.map((onboarding) => ({
      onboardingId: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status as 'awaiting_user' | 'approved',
      currentStep: onboarding.currentStep,
      expiresAt: onboarding.expiresAt,
      createdAt: onboarding.createdAt,
      updatedAt: onboarding.updatedAt,
      completedAt: onboarding.completedAt,
    }));
  }

  async submit(onboardingId: string, submittedData: unknown): Promise<SubmitOnboardingResponse> {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new OnboardingNotFoundException();
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
      const evaluationResult = await workflow.evaluate({
        currentStep: onboarding.currentStep,
        submittedData,
        onboardingContext: onboarding.context,
      });

      if (!evaluationResult) {
        return {
          kind: 'rejected',
          problem: {
            type: '/problems/invalid-step-data',
            title: 'Invalid step data',
            status: 400,
            code: 'INVALID_STEP_DATA',
            fieldErrors: [],
          },
        };
      }

      if (evaluationResult.kind === 'rejected') {
        const problem = evaluationResult.problem;
        await this.onboardingsRepository.createHistoryEntry(manager, {
          onboardingId,
          appliedStep: onboarding.currentStep ?? 'collect_contact',
          outcome: 'validation_rejected',
          resultingStatus: onboarding.status as 'awaiting_user' | 'approved',
          resultingCurrentStep: onboarding.currentStep,
          fieldErrors: problem.fieldErrors,
        });

        return {
          kind: 'rejected',
          problem,
        };
      }

      const nextStatus = evaluationResult.terminal ? 'approved' : evaluationResult.status;
      const nextCurrentStep = evaluationResult.terminal ? null : evaluationResult.currentStep;
      const nextCompletedAt = evaluationResult.terminal ? new Date() : null;

      await this.onboardingsRepository.createHistoryEntry(manager, {
        onboardingId,
        appliedStep: evaluationResult.appliedStep,
        outcome: 'transitioned',
        resultingStatus: nextStatus,
        resultingCurrentStep: nextCurrentStep,
        fieldErrors: null,
      });

      onboarding.context = {
        ...onboarding.context,
        ...evaluationResult.acceptedData,
      };
      onboarding.status = nextStatus;
      onboarding.currentStep = nextCurrentStep;
      onboarding.completedAt = nextCompletedAt;

      await this.onboardingsRepository.saveLocked(manager, onboarding);

      return {
        kind: 'accepted',
        appliedStep: evaluationResult.appliedStep,
        status: nextStatus as 'awaiting_user' | 'approved',
        currentStep: nextCurrentStep,
      };
    });
  }

  async getById(onboardingId: string): Promise<OnboardingJourneyStateDescriptor> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );
    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    const workflow = this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );
    const currentStep = workflow.describeActiveStep(onboarding.currentStep);

    return {
      onboardingId: onboarding.id,
      status: onboarding.status as 'awaiting_user' | 'approved',
      currentStep,
    };
  }

  async getState(onboardingId: string): Promise<OnboardingJourneyStateDescriptor> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );
    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    const workflow = this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );
    const currentStep = workflow.describeActiveStep(onboarding.currentStep);

    return {
      onboardingId: onboarding.id,
      status: onboarding.status as 'awaiting_user' | 'approved',
      currentStep,
    };
  }

  async getHistory(onboardingId: string): Promise<OnboardingSafeHistoryItem[]> {
    await this.getById(onboardingId);

    const historyEntries = await this.onboardingsRepository.findHistoryByOnboardingId(
      this.dataSource.manager,
      onboardingId,
    );

    return historyEntries.map((entry) => ({
      event: entry.outcome,
      appliedStep: entry.appliedStep,
      resultingStatus: entry.resultingStatus as 'awaiting_user' | 'approved',
      resultingCurrentStep: entry.resultingCurrentStep,
      timestamp: entry.recordedAt.toISOString(),
      fieldErrors: entry.fieldErrors ?? undefined,
    }));
  }
}
