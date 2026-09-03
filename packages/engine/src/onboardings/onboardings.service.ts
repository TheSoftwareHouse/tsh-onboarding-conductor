import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { ListAdminOnboardingsResponseDto } from './dto/list-admin-onboardings.response.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import type { WorkflowManualTransitionStatus, WorkflowStatus } from '@tsh/ddl-schema';
import {
  ConnectorExecutionResult,
  type ConnectorExecutionStatus,
  type ConnectorPendingExecution,
} from '../connectors/ports/connector-execution-result';
import { ManualTransitionNotAvailableException } from './errors/manual-transition-not-available.exception';
import { OnboardingCompletedException } from './errors/onboarding-completed.exception';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { InvalidStepDataException } from './errors/invalid-step-data.exception';
import type { OnboardingEntity } from './entity/onboarding.entity';
import { UnknownWorkflowEvaluationException } from './errors/unknown-workflow-evaluation.exception';
import { AuditService, RejectedAttemptOutcome } from '../audit/audit.service';
import { toPaginatedMeta } from '../pagination';
import { OnboardingsRepository } from './onboardings.repository';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import type { ConnectorRejectionReason } from '../connectors/ports/connector-execution.port';
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

export type ConnectorExecutionAuditProjection = {
  status: ConnectorExecutionStatus;
  errors?: Readonly<Record<string, readonly string[]>>;
  reason?: ConnectorRejectionReason;
  metadata?: Readonly<Record<string, unknown>>;
  pending?: ConnectorPendingExecution;
};

type SubmitContinuation = Readonly<{
  providerIdentity?: string;
  resolvedConnector?: Readonly<{
    connectorOrder: number;
    result: ConnectorExecutionResult;
  }>;
}>;

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
  score: number;
}

/**
 * One onboarding read on its own. Carries the per-step breakdown the list deliberately omits — a
 * jsonb map per row is noise in a table, but it is the first thing an operator wants when asking
 * why a single applicant scored what they did.
 */
export interface AdminOnboardingDetail extends AdminOnboardingSummary {
  scoreByStep: Readonly<Record<string, number>>;
}

@Injectable()
export class OnboardingsService {
  private readonly logger = new Logger(OnboardingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly webhookService: WebhookService,
    private readonly auditService: AuditService,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponse> {
    const workflow = await this.workflowRegistryService.getById(dto.workflowId);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();

    const onboarding = await this.dataSource.transaction(async (manager) => {
      const createdOnboarding = await this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        score: 0,
        scoreByStep: {},
        expiresAt: null,
        completedAt: null,
        rejectionReason: null,
      });

      await this.auditService.log(manager, {
        action: 'onboarding.started',
        onboarding: {
          id: createdOnboarding.id,
          workflowId: createdOnboarding.workflowId,
          workflowVersion: createdOnboarding.workflowVersion,
          status: createdOnboarding.status,
          currentStep: createdOnboarding.currentStep,
          score: createdOnboarding.score,
        },
        appliedStep: null,
      });

      return createdOnboarding;
    });

    await this.webhookService.notify(onboarding, workflow);

    return {
      onboardingId,
      status: onboarding.status,
      currentStep: onboarding.currentStep,
      expiresAt: null,
    };
  }

  async listForAdmin(
    query: ListAdminOnboardingsQueryDto,
  ): Promise<ListAdminOnboardingsResponseDto> {
    const result = await this.onboardingsRepository.findForAdmin(this.dataSource.manager, query);

    return {
      items: result.items.map((onboarding) => this.toAdminSummary(onboarding)),
      meta: toPaginatedMeta(result),
    };
  }

  /**
   * One onboarding by id, in the same shape the list reports it. A reader opening a single record
   * asks for it by primary key rather than filtering the list down to one row, so an id that
   * matches nothing is a plain not-found instead of an empty page.
   */
  async getForAdmin(onboardingId: string): Promise<AdminOnboardingDetail> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    return { ...this.toAdminSummary(onboarding), scoreByStep: onboarding.scoreByStep };
  }

  private toAdminSummary(onboarding: OnboardingEntity): AdminOnboardingSummary {
    return {
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
      score: onboarding.score,
    };
  }

  async manualReview(onboardingId: string, trigger: WorkflowManualTransitionStatus) {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      await this.auditService.logRejectedAttempt(this.dataSource, {
        operation: 'manual_review',
        outcome: 'onboarding_not_found',
        resourceId: onboardingId,
      });
      throw new OnboardingNotFoundException();
    }

    const workflow = await this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );

    try {
      const response = await this.dataSource.transaction(async (manager) => {
        await this.onboardingsRepository.lockAndRefreshPreflight(manager, onboarding);
        onboarding.capturePreMutationWebhookSnapshot();

        if (onboarding.isApproved() || onboarding.isCompleted()) {
          throw new OnboardingCompletedException();
        }

        const result = workflow.evaluateManual(
          {
            currentStep: onboarding.currentStep,
            submittedData: {},
            onboardingContext: onboarding.context,
            scoreByStep: onboarding.scoreByStep,
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
        const previousOnboarding = {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          score: onboarding.score,
        };

        onboarding.setLifecycleTakenTransition(result.getTakenTransition());

        Object.assign(onboarding, nextState);
        await this.onboardingsRepository.saveLocked(manager, onboarding);
        await this.auditService.log(manager, {
          action: 'onboarding.manual_review_decision',
          previousOnboarding,
          newOnboarding: onboarding,
          appliedStep,
          manualTrigger: trigger,
          stepScore: result.getStepScore(),
          skippedSteps: result.getSkippedSteps(),
        });

        return {
          appliedStep,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
        };
      });

      await this.webhookService.notify(onboarding, workflow);

      return response;
    } catch (error: unknown) {
      const rejectedAttemptOutcome = this.mapManualReviewRejectedAttemptOutcome(error);

      if (rejectedAttemptOutcome !== null) {
        await this.auditService.logRejectedAttempt(this.dataSource, {
          operation: 'manual_review',
          outcome: rejectedAttemptOutcome,
          resourceId: onboardingId,
        });
      }

      await this.webhookService.notifyError(error, onboarding, workflow);

      throw error;
    }
  }

  async submit(
    onboardingId: string,
    submittedData: unknown,
    continuation?: SubmitContinuation,
  ): Promise<SubmitOnboardingResponse> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      await this.auditService.logRejectedAttempt(this.dataSource, {
        operation: 'submit',
        outcome: 'onboarding_not_found',
        resourceId: onboardingId,
      });
      throw new OnboardingNotFoundException();
    }

    const workflow = await this.workflowRegistryService.getById(
      onboarding.workflowId,
      onboarding.workflowVersion,
    );

    try {
      const response = await this.dataSource.transaction(async (manager) => {
        await this.onboardingsRepository.lockAndRefreshPreflight(manager, onboarding);
        onboarding.capturePreMutationWebhookSnapshot();

        if (onboarding.isApproved() || onboarding.isCompleted()) {
          throw new OnboardingCompletedException();
        }

        const evaluationResult = await workflow.evaluate({
          currentStep: onboarding.currentStep,
          submittedData,
          onboardingContext: onboarding.context,
          onboardingId: onboarding.id,
          scoreByStep: onboarding.scoreByStep,
          continuation:
            continuation?.resolvedConnector !== undefined
              ? { resolvedConnector: continuation.resolvedConnector }
              : undefined,
        });

        if (evaluationResult.isRetryableInvalidData()) {
          throw new InvalidStepDataException(evaluationResult.getErrors());
        }

        if (evaluationResult.isUnknownEvaluation()) {
          throw new UnknownWorkflowEvaluationException();
        }

        const previousOnboarding = {
          id: onboarding.id,
          workflowId: onboarding.workflowId,
          workflowVersion: onboarding.workflowVersion,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          score: onboarding.score,
        };

        const nextState = evaluationResult.getNextState()!;
        const appliedStep = evaluationResult.getAppliedStep();

        onboarding.setLifecycleTakenTransition(evaluationResult.getTakenTransition());

        Object.assign(onboarding, nextState);

        await this.onboardingsRepository.saveLocked(manager, onboarding);
        await this.auditService.log(manager, {
          action: 'onboarding.state_transition',
          previousOnboarding,
          newOnboarding: onboarding,
          appliedStep: appliedStep ?? null,
          stepScore: evaluationResult.getStepScore(),
          skippedSteps: evaluationResult.getSkippedSteps(),
        });

        if (
          continuation?.providerIdentity !== undefined &&
          continuation.resolvedConnector !== undefined
        ) {
          await this.auditService.logWebhook(manager, {
            action: 'webhook.inbound_callback_applied',
            resourceType: 'onboarding',
            resourceId: onboarding.id,
            metadata: {
              providerIdentity: continuation.providerIdentity,
              connectorOrder: continuation.resolvedConnector.connectorOrder,
              submittedData,
              connectorExecutionResult: this.mapConnectorExecutionResult(
                continuation.resolvedConnector.result,
              ),
              outcome: 'persisted',
            },
          });
        }

        return {
          appliedStep: appliedStep ?? null,
          status: onboarding.status,
          currentStep: onboarding.currentStep,
          rejectionReason: onboarding.rejectionReason,
        } satisfies SubmitOnboardingResponse;
      });

      await this.webhookService.notify(onboarding, workflow);

      return response;
    } catch (error: unknown) {
      const rejectedAttemptOutcome = this.mapSubmitRejectedAttemptOutcome(error);

      if (rejectedAttemptOutcome !== null) {
        await this.auditService.logRejectedAttempt(this.dataSource, {
          operation: 'submit',
          outcome: rejectedAttemptOutcome,
          resourceId: onboardingId,
        });
      }

      await this.webhookService.notifyError(error, onboarding, workflow);

      throw error;
    }
  }

  private mapSubmitRejectedAttemptOutcome(error: unknown): RejectedAttemptOutcome | null {
    if (error instanceof OnboardingCompletedException) {
      return 'onboarding_completed';
    }

    if (error instanceof InvalidStepDataException) {
      return 'retryable_invalid_data';
    }

    if (error instanceof UnknownWorkflowEvaluationException) {
      return 'unknown_workflow_evaluation';
    }

    return null;
  }

  private mapConnectorExecutionResult(
    result: ConnectorExecutionResult,
  ): ConnectorExecutionAuditProjection {
    const projection: ConnectorExecutionAuditProjection = {
      status: result.status,
    };

    if (result.errors !== undefined) {
      projection.errors = result.errors;
    }

    if (result.reason !== undefined) {
      projection.reason = result.reason;
    }

    if (result.metadata !== undefined) {
      projection.metadata = result.metadata;
    }

    if (result.pending !== undefined) {
      projection.pending = result.pending;
    }

    return projection;
  }

  private mapManualReviewRejectedAttemptOutcome(error: unknown): RejectedAttemptOutcome | null {
    if (error instanceof OnboardingCompletedException) {
      return 'onboarding_completed';
    }

    if (error instanceof ManualTransitionNotAvailableException) {
      return 'transition_unavailable';
    }

    if (error instanceof UnknownWorkflowEvaluationException) {
      return 'unknown_workflow_evaluation';
    }

    return null;
  }
}
