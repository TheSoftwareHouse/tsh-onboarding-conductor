import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditService, type OnboardingLifecycleEntry } from '../audit/audit.service';
import type { Workflow } from '../workflows/domain/workflow';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import {
  ListOnboardingTransitionsResponseDto,
  OnboardingTransitionResponseDto,
} from './dto/list-onboarding-transitions.response.dto';
import type { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingNotFoundException } from './errors/onboarding-not-found.exception';
import { OnboardingsRepository } from './onboardings.repository';

/**
 * How many recorded moves one request reads. A journey through a workflow is naturally short, so
 * this only ever bites an onboarding that looped — and a reader shown its most recent hundred
 * moves is told the earlier ones exist rather than left to assume it saw everything.
 */
const TRANSITIONS_LIMIT = 100;

@Injectable()
export class OnboardingTransitionsService {
  private readonly logger = new Logger(OnboardingTransitionsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly onboardingsRepository: OnboardingsRepository,
    private readonly auditService: AuditService,
    private readonly workflowRegistryService: WorkflowRegistryService,
  ) {}

  /**
   * The chain of states one onboarding moved through.
   *
   * The trail says which step each move left and which it landed on, except for a terminal move,
   * which clears the current step. The workflow revision the onboarding runs on is what names that
   * last step, so it is resolved here rather than left to every reader to infer.
   */
  async listTransitions(onboardingId: string): Promise<ListOnboardingTransitionsResponseDto> {
    const manager = this.dataSource.manager;
    const onboarding = await this.onboardingsRepository.findById(manager, onboardingId);

    if (!onboarding) {
      throw new OnboardingNotFoundException();
    }

    const trail = await this.auditService.listOnboardingLifecycle(
      manager,
      onboardingId,
      TRANSITIONS_LIMIT,
    );
    const workflow = await this.findWorkflowForNaming(onboarding);

    return {
      items: trail.entries.map((entry, index) =>
        this.toTransition(entry, workflow, index === trail.entries.length - 1),
      ),
      meta: { truncated: trail.truncated },
    };
  }

  private toTransition(
    entry: OnboardingLifecycleEntry,
    workflow: Workflow | null,
    current: boolean,
  ): OnboardingTransitionResponseDto {
    const move = {
      status: entry.metadata.toStatus,
      fromStep: entry.metadata.fromCurrentStep,
      appliedStep: entry.metadata.appliedStep,
      toStep: entry.metadata.toCurrentStep,
    };

    return {
      id: entry.id,
      occurredAt: entry.occurredAt,
      status: move.status,
      fromStep: move.fromStep,
      appliedStep: move.appliedStep,
      enteredStep: workflow === null ? move.toStep : workflow.resolveEnteredStep(move),
      trigger: entry.metadata.manualTrigger ?? null,
      current,
    };
  }

  /**
   * The workflow is consulted only to name the step a terminal move entered, so a revision that
   * can no longer be resolved — retired, or dropped from the store — costs those names rather than
   * the whole answer. Refusing the trail would be the worse trade: the audit log recorded the
   * journey in full, and it is the part of this response a reader cannot reconstruct elsewhere.
   */
  private async findWorkflowForNaming(onboarding: OnboardingEntity): Promise<Workflow | null> {
    try {
      return await this.workflowRegistryService.getById(
        onboarding.workflowId,
        onboarding.workflowVersion,
      );
    } catch (cause) {
      this.logger.warn(
        `Cannot name terminal steps for onboarding ${onboarding.id}: workflow ${onboarding.workflowId} v${onboarding.workflowVersion} did not resolve (${cause instanceof Error ? cause.message : String(cause)})`,
      );

      return null;
    }
  }
}
