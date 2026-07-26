import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import type { WorkflowManualTransitionStatus, WorkflowStatus } from '@tsh/ddl-schema';
import { ManualTransitionNotAvailableException } from './errors/manual-transition-not-available.exception';
import { OnboardingCompletedException } from './errors/onboarding-completed.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { UnknownWorkflowEvaluationException } from './errors/unknown-workflow-evaluation.exception';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import type { ConnectorRejectionReason } from '../connectors/ports/connector-execution.port';
import { WebhookEventType } from '../webhook/webhook-event';
import { WebhookService } from '../webhook/webhook.service';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: WorkflowStatus;
  currentStep: string | null;
  expiresAt: null;
}

export interface SubmitOnboardingResponse {
  appliedStep: string | null;
  status: WorkflowStatus;
  currentStep: string | null;
  rejectionReason: ConnectorRejectionReason | null;
}

export interface AdminOnboardingSummary {
  onboardingId: string;
  workflowId: string;
  workflowVersion: number;
  status: WorkflowStatus;
  currentStep: string | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  rejectionReason: ConnectorRejectionReason | null;
}

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly webhookService: WebhookService,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponse> {
    const workflow = this.workflowRegistryService.getById(dto.workflowId, 1);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();
    return this.dataSource.transaction(async (manager) => {
      await this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        expiresAt: null,
        completedAt: null,
        rejectionReason: null,
      });

      return {
        onboardingId,
        status: initialState.status,
        currentStep: initialState.currentStep,
        expiresAt: null,
      } satisfies CreateOnboardingResponse;
    });
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
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      expiresAt: onboarding.expiresAt,
      createdAt: onboarding.createdAt,
      updatedAt: onboarding.updatedAt,
      completedAt: onboarding.completedAt,
      rejectionReason: onboarding.rejectionReason,
    }));
  }

  async manualReview(onboardingId: string, trigger: WorkflowManualTransitionStatus) {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new OnboardingNotFoundException();
      }

      if (onboarding.isApproved() || onboarding.isCompleted()) {
        throw new OnboardingCompletedException();
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
      const result = workflow.evaluateManual(
        {
          currentStep: onboarding.currentStep,
          submittedData: {},
          onboardingContext: onboarding.context,
        },
        trigger,
      );

      if (result.isManualTransitionUnavailable()) {
        throw new ManualTransitionNotAvailableException();
      }

      if (result.isUnknownEvaluation()) {
        throw new UnknownWorkflowEvaluationException();
      }

      const nextState = result.getNextState()!;
      const appliedStep = result.getAppliedStep();

      Object.assign(onboarding, nextState);
      await this.onboardingsRepository.saveLocked(manager, onboarding);
      await this.webhookService.notify(
        manager,
        workflow,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        onboarding,
      );

      return {
        appliedStep,
        status: onboarding.status,
        currentStep: onboarding.currentStep,
      };
    });
  }

  async submit(onboardingId: string, submittedData: unknown): Promise<SubmitOnboardingResponse> {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new OnboardingNotFoundException();
      }

      if (onboarding.isApproved() || onboarding.isCompleted()) {
        throw new OnboardingCompletedException();
      }

      const workflow = this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );

      const evaluationResult = await workflow.evaluate({
        currentStep: onboarding.currentStep,
        submittedData,
        onboardingContext: onboarding.context,
        onboardingId: onboarding.id,
      });

      if (evaluationResult.isRetryableInvalidData()) {
        throw new InvalidStepDataException(evaluationResult.getErrors());
      }

      if (evaluationResult.isUnknownEvaluation()) {
        throw new UnknownWorkflowEvaluationException();
      }

      const nextState = evaluationResult.getNextState()!;
      const appliedStep = evaluationResult.getAppliedStep();

      Object.assign(onboarding, nextState);

      await this.onboardingsRepository.saveLocked(manager, onboarding);

      await this.webhookService.notify(
        manager,
        workflow,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        onboarding,
      );

      return {
        appliedStep: appliedStep ?? null,
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        rejectionReason: onboarding.rejectionReason,
      } satisfies SubmitOnboardingResponse;
    });
  }
}
