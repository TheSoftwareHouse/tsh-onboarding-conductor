import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AgreementsService } from '../agreements/agreements.service';
import { AgreementEntity } from '../agreements/entity/agreement.entity';
import { AgreementNotFoundException } from '../agreements/errors/agreement-not-found.exception';
import { AgreementNotPublishedException } from '../agreements/errors/agreement-not-published.exception';
import { AdminOnboardingSummaryResponseDto } from './dto/admin-onboarding-summary.response.dto';
import { CreateOnboardingDto } from './dto/create-onboarding.dto';
import { CreateOnboardingResponseDto } from './dto/create-onboarding.response.dto';
import { ManualReviewResponseDto } from './dto/manual-review.response.dto';
import { SubmitOnboardingResponseDto } from './dto/submit-onboarding.response.dto';
import { ListAdminOnboardingsQueryDto } from './dto/list-admin-onboardings.query.dto';
import { ListAdminOnboardingsResponseDto } from './dto/list-admin-onboardings.response.dto';
import {
  AcceptAgreementResponseDto,
  LinkAgreementResponseDto,
  OnboardingAgreementsResponseDto,
  toOnboardingAgreementsResponse,
} from './dto/onboarding-agreements.response.dto';
import { generateUuidV7 } from '../utils/uuid.util';
import type { WorkflowManualTransitionStatus } from '@tsh/ddl-schema';
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
import { markAuditRecorded } from '../audit/audit-recorded.marker';
import { toPaginatedMeta } from '../pagination';
import { OnboardingAgreementsRepository } from './onboarding-agreements.repository';
import { OnboardingsRepository } from './onboardings.repository';
import type { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import type { ConnectorRejectionReason } from '../connectors/ports/connector-execution.port';
import { WebhookService } from '../webhook/webhook.service';

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

@Injectable()
export class OnboardingsService {
  private readonly logger = new Logger(OnboardingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly workflowRegistryService: WorkflowRegistryService,
    private readonly webhookService: WebhookService,
    private readonly auditService: AuditService,
    private readonly agreementsService: AgreementsService,
    private readonly onboardingAgreementsRepository: OnboardingAgreementsRepository,
  ) {}

  async start(dto: CreateOnboardingDto): Promise<CreateOnboardingResponseDto> {
    const workflow = await this.workflowRegistryService.getById(dto.workflowId);
    const initialState = workflow.initialize();

    const onboardingId = generateUuidV7();

    const onboarding = await this.dataSource.transaction(async (manager) => {
      // Resolved before the row exists: a family the workflow declares but nobody published is a
      // configuration gap, and an onboarding created against it would owe an agreement that does
      // not exist.
      const agreements = await this.resolveDeclaredAgreements(
        manager,
        workflow.getDeclaredAgreementKeys(),
      );

      const createdOnboarding = await this.onboardingsRepository.createInitial(manager, {
        id: onboardingId,
        workflowId: initialState.workflowId,
        workflowVersion: initialState.workflowVersion,
        status: initialState.status,
        currentStep: initialState.currentStep,
        context: {},
        expiresAt: null,
        completedAt: null,
        rejectionReason: null,
        scores: initialState.scores,
      });

      await this.auditService.log(manager, {
        action: 'onboarding.started',
        onboarding: {
          id: createdOnboarding.id,
          workflowId: createdOnboarding.workflowId,
          workflowVersion: createdOnboarding.workflowVersion,
          status: createdOnboarding.status,
          currentStep: createdOnboarding.currentStep,
          scores: createdOnboarding.scores,
        },
        appliedStep: null,
      });

      // Deliberately silent: the step collecting these agreements renders them itself, and the
      // creation already notifies through `onboarding.state_changed`.
      for (const agreement of agreements) {
        await this.agreementsService.linkPending(
          manager,
          agreement,
          createdOnboarding.id,
          'onboarding_start',
        );
      }

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
  async getForAdmin(onboardingId: string): Promise<AdminOnboardingSummaryResponseDto> {
    return this.toAdminSummary(await this.getOnboarding(onboardingId));
  }

  /**
   * Every agreement family this onboarding holds, as accepted-versus-latest.
   *
   * Read outside a transaction: it is a report, and the link rows it reads are each written
   * atomically by whoever wrote them.
   */
  async listAgreements(onboardingId: string): Promise<OnboardingAgreementsResponseDto> {
    const onboarding = await this.getOnboarding(onboardingId);
    const summaries = await this.onboardingAgreementsRepository.findSummaries(
      this.dataSource.manager,
      onboarding.id,
    );

    return toOnboardingAgreementsResponse(onboarding.id, summaries);
  }

  /**
   * Links one published version to one onboarding as `pending`, out of band of any flow the user
   * is walking — which is exactly the case the agreement notification exists for.
   *
   * Idempotent, and at most one notification per link: `linkPending` reports whether the pair was
   * already linked, and a repeat enqueues nothing. The notification goes out only once the
   * transaction has committed, for the same reason the publish fan-out waits — an outbox row for
   * a rolled-back link would announce an agreement nobody owes.
   */
  async linkAgreement(
    onboardingId: string,
    agreementId: string,
  ): Promise<LinkAgreementResponseDto> {
    const onboarding = await this.getOnboarding(onboardingId);

    const link = await this.dataSource.transaction(async (manager) => {
      const agreement = await this.agreementsService.getById(manager, agreementId);
      const created = await this.agreementsService.linkPending(
        manager,
        agreement,
        onboarding.id,
        'manual',
      );

      return {
        agreement,
        created,
        previousAcceptedVersion: created
          ? await this.findAcceptedVersion(manager, onboarding.id, agreement.key)
          : null,
      };
    });

    if (link.created) {
      // The link and its audit row are already committed. A workflow revision that no longer
      // loads costs this link its notification and nothing else - failing the request here would
      // hand the caller a 404 over work that succeeded, and the retry it invites reports
      // `created: false` and enqueues nothing, losing the notification for good.
      const workflow = await this.findWorkflow(onboarding);

      if (workflow !== undefined) {
        await this.webhookService.notifyAgreementPending(
          onboarding,
          workflow,
          link.agreement,
          link.previousAcceptedVersion,
        );
      }
    }

    return {
      onboardingId: onboarding.id,
      agreementId: link.agreement.id,
      key: link.agreement.key,
      version: link.agreement.version,
      created: link.created,
    };
  }

  /**
   * Records that the end user accepted one published version.
   *
   * Deliberately not gated on the lifecycle status: an approved customer still has to be able to
   * accept a new version of the terms, and refusing here would leave them permanently outdated
   * with no way back. Accepting a version that has since been superseded is allowed too — it
   * simply leaves the family `outdated`.
   *
   * It is gated on the link already existing, and that is what keeps this route from being a
   * second, unguarded way to create one: the pair must already be linked by a start, a submit, a
   * publish or an operator's `POST /agreements`, all of which decide which families an onboarding
   * owes. Without it, anyone holding an onboarding id could attach any published version to it and
   * make the next publish of that family notify the client's endpoint.
   */
  async acceptAgreement(
    onboardingId: string,
    agreementId: string,
  ): Promise<AcceptAgreementResponseDto> {
    const onboarding = await this.getOnboarding(onboardingId);

    return this.dataSource.transaction(async (manager) => {
      const agreement = await this.agreementsService.getById(manager, agreementId);
      const existing = await this.onboardingAgreementsRepository.findLink(
        manager,
        agreement,
        onboarding.id,
      );

      if (existing === undefined) {
        throw new AgreementNotFoundException();
      }

      const link = await this.onboardingAgreementsRepository.acceptLink(
        manager,
        agreement,
        onboarding.id,
        new Date(),
      );

      await this.auditService.logAgreement(manager, {
        action: 'agreement.accepted',
        resourceId: onboarding.id,
        metadata: {
          agreementId: agreement.id,
          key: agreement.key,
          version: agreement.version,
          origin: 'manual',
        },
      });

      return {
        onboardingId: onboarding.id,
        agreementId: agreement.id,
        key: agreement.key,
        version: agreement.version,
        acceptedAt: link.acceptedAt === null ? null : link.acceptedAt.toISOString(),
      };
    });
  }

  private async getOnboarding(onboardingId: string): Promise<OnboardingEntity> {
    const onboarding = await this.onboardingsRepository.findById(
      this.dataSource.manager,
      onboardingId,
    );

    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    return onboarding;
  }

  /**
   * The workflow revision an onboarding was started against, or `undefined` when it can no longer
   * be loaded. Only for notifying after a committed write: the event is addressed to that
   * revision's own notify webhook, and a revision that has gone costs the event, not the write.
   */
  private async findWorkflow(onboarding: OnboardingEntity): Promise<Workflow | undefined> {
    return this.workflowRegistryService
      .getById(onboarding.workflowId, onboarding.workflowVersion)
      .catch(() => {
        this.logger.warn(
          `AGREEMENT_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} reason=workflow_unavailable workflowId=${onboarding.workflowId} workflowVersion=${onboarding.workflowVersion}`,
        );

        return undefined;
      });
  }

  /**
   * The highest version of a family this onboarding has accepted, which the agreement
   * notification reports as what it is now behind on. Absent from the summaries — or held but
   * never accepted — is a null, not a zero.
   */
  private async findAcceptedVersion(
    manager: EntityManager,
    onboardingId: string,
    key: string,
  ): Promise<number | null> {
    const summaries = await this.onboardingAgreementsRepository.findSummaries(
      manager,
      onboardingId,
    );

    return summaries.find((summary) => summary.key === key)?.acceptedVersion ?? null;
  }

  private toAdminSummary(onboarding: OnboardingEntity): AdminOnboardingSummaryResponseDto {
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
      scores: onboarding.scores,
      agreementStatus: onboarding.getAgreementStatus(),
    };
  }

  async manualReview(
    onboardingId: string,
    trigger: WorkflowManualTransitionStatus,
  ): Promise<ManualReviewResponseDto> {
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
      throw markAuditRecorded(new OnboardingNotFoundException());
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
            onboardingScores: onboarding.scores,
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
          scores: onboarding.scores,
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
        markAuditRecorded(error);
      }

      await this.webhookService.notifyError(error, onboarding, workflow);

      throw error;
    }
  }

  async submit(
    onboardingId: string,
    submittedData: unknown,
    continuation?: SubmitContinuation,
  ): Promise<SubmitOnboardingResponseDto> {
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
      throw markAuditRecorded(new OnboardingNotFoundException());
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
          onboardingScores: onboarding.scores,
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
          scores: onboarding.scores,
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
        });

        await this.acceptDeclaredAgreements(manager, workflow, appliedStep ?? null, onboarding);

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
        } satisfies SubmitOnboardingResponseDto;
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
        markAuditRecorded(error);
      }

      await this.webhookService.notifyError(error, onboarding, workflow);

      throw error;
    }
  }

  /**
   * The highest published version of each family named, in the order asked for. A key nobody has
   * published stops the caller here rather than letting an onboarding proceed owing an agreement
   * that does not exist.
   */
  private async resolveDeclaredAgreements(
    manager: EntityManager,
    keys: readonly string[],
  ): Promise<AgreementEntity[]> {
    if (keys.length === 0) {
      return [];
    }

    const latestByKey = await this.agreementsService.findLatestForKeys(manager, keys);

    return keys.map((key) => {
      const agreement = latestByKey.get(key);

      if (agreement === undefined) {
        throw new AgreementNotPublishedException(key);
      }

      return agreement;
    });
  }

  /**
   * Records the acceptances the step just applied carries, in the transaction that wrote the
   * state they came from.
   *
   * Each declaration names a boolean field of the step it binds to, which the workflow validator
   * already proved is declared and persisted, so the marker is simply read back from the
   * post-transition context. A step no declaration binds to — or one whose families the user did
   * not tick — returns without asking the database anything.
   */
  private async acceptDeclaredAgreements(
    manager: EntityManager,
    workflow: Workflow,
    appliedStep: string | null,
    onboarding: OnboardingEntity,
  ): Promise<void> {
    const declarations = workflow.findStepAgreements(appliedStep);
    const acceptedKeys = declarations
      .filter((declaration) => onboarding.context[declaration.acceptedWhen] === true)
      .map((declaration) => declaration.key);

    if (acceptedKeys.length === 0) {
      return;
    }

    const agreements = await this.resolveDeclaredAgreements(manager, acceptedKeys);
    const acceptedAt = new Date();

    for (const agreement of agreements) {
      await this.onboardingAgreementsRepository.acceptLink(
        manager,
        agreement,
        onboarding.id,
        acceptedAt,
      );
      await this.auditService.logAgreement(manager, {
        action: 'agreement.accepted',
        resourceId: onboarding.id,
        metadata: {
          agreementId: agreement.id,
          key: agreement.key,
          version: agreement.version,
          origin: 'step_submit',
        },
      });
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

    // `null` means no `onboarding.rejected_attempt` row was written for this error - e.g. the
    // ONBOARDING_LOCK_REFRESH_FAILED path or a connector-propagated failure. Leave the error
    // unmarked so the global exception filter records it; do not mark these paths.
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

    // `null` means no `onboarding.rejected_attempt` row was written for this error - e.g. the
    // ONBOARDING_LOCK_REFRESH_FAILED path or a connector-propagated failure. Leave the error
    // unmarked so the global exception filter records it; do not mark these paths.
    return null;
  }
}
