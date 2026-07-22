import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { ClientWebhookEventType } from '../client-webhook-outbox/client-webhook-event';
import { ClientWebhookNotifyService } from '../client-webhook-outbox/client-webhook-notify.service';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import type { WorkflowStatus } from '@tsh/ddl-schema';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import { ManualTransitionNotAvailableException } from './errors/manual-transition-not-available.exception';
import { OnboardingCompletedException } from './errors/onboarding-completed.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingWebhookService } from './onboarding-webhook/onboarding-webhook.service';

type WorkflowTransitionStatus = 'manual.approve' | 'manual.reject' | 'manual.return';

export interface CreateOnboardingResponse {
  onboardingId: string;
  status: WorkflowStatus;
  currentStep: string | null;
  expiresAt: null;
}

export interface SubmitOnboardingResponse {
  appliedStep: string;
  status: WorkflowStatus;
  currentStep: string | null;
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
}

@Injectable()
export class OnboardingsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly onboardingWebhookService: OnboardingWebhookService,
    private readonly clientWebhookNotifyService: ClientWebhookNotifyService,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponse> {
    const workflow = this.workflowRegistryService.getById(dto.workflowId, 1);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();
    const { response, outboxId } = await this.dataSource.transaction(async (manager) => {
      await this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        expiresAt: null,
        completedAt: null,
      });

      const createdOutboxId = await this.onboardingWebhookService.createPendingEvent(
        manager,
        ClientWebhookEventType.ONBOARDING_CREATED,
        {
          id: onboardingId,
          workflowId: initialState.workflowId,
          workflowVersion: initialState.workflowVersion,
          status: initialState.status,
          currentStep: initialState.currentStep,
          completedAt: null,
        },
      );

      return {
        response: {
          onboardingId,
          status: initialState.status,
          currentStep: initialState.currentStep,
          expiresAt: null,
        } satisfies CreateOnboardingResponse,
        outboxId: createdOutboxId,
      };
    });

    await this.notifyIfCreated(outboxId);

    return response;
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
      status: onboarding.status as WorkflowStatus,
      currentStep: onboarding.currentStep,
      expiresAt: onboarding.expiresAt,
      createdAt: onboarding.createdAt,
      updatedAt: onboarding.updatedAt,
      completedAt: onboarding.completedAt,
    }));
  }

  async manualReview(onboardingId: string, trigger: WorkflowTransitionStatus) {
    return this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new OnboardingNotFoundException();
      }

      if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
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

      if (!result) {
        throw new ManualTransitionNotAvailableException();
      }

      const isRecursiveResult =
        result.nextState.currentStep === onboarding.currentStep &&
        result.nextState.status === onboarding.status &&
        result.nextState.completedAt === onboarding.completedAt;

      if (!isRecursiveResult) {
        Object.assign(onboarding, result.nextState);
        await this.onboardingsRepository.saveLocked(manager, onboarding);
      }

      return {
        appliedStep: result.appliedStep,
        status: onboarding.status as WorkflowStatus,
        currentStep: onboarding.currentStep,
      };
    });
  }

  async submit(onboardingId: string, submittedData: unknown): Promise<SubmitOnboardingResponse> {
    const { response, outboxId } = await this.dataSource.transaction(async (manager) => {
      const onboarding = await this.onboardingsRepository.findByIdForUpdate(manager, onboardingId);

      if (!onboarding) {
        throw new OnboardingNotFoundException();
      }

      if (onboarding.status === 'approved' || onboarding.completedAt !== null) {
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

      if (!evaluationResult) {
        throw new InvalidStepDataException();
      }

      Object.assign(onboarding, evaluationResult.nextState);

      await this.onboardingsRepository.saveLocked(manager, onboarding);
      const createdOutboxId = await this.onboardingWebhookService.createPendingEvent(
        manager,
        ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
        {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          completedAt: onboarding.completedAt,
        },
      );

      return {
        response: {
          appliedStep: evaluationResult.appliedStep,
          status: evaluationResult.nextState.status,
          currentStep: evaluationResult.nextState.currentStep,
        } satisfies SubmitOnboardingResponse,
        outboxId: createdOutboxId,
      };
    });

    await this.notifyIfCreated(outboxId);

    return response;
  }

  private notifyIfCreated = async (outboxId: string | null): Promise<void> => {
    if (outboxId) {
      await this.clientWebhookNotifyService.notify(outboxId);
    }
  };
}
