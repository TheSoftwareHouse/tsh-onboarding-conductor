import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

export type RejectedAttemptOperation = 'submit' | 'manual_review';
export type RejectedAttemptOutcome =
  | 'onboarding_not_found'
  | 'onboarding_completed'
  | 'retryable_invalid_data'
  | 'unknown_workflow_evaluation'
  | 'unsupported_action'
  | 'transition_unavailable';

export type RejectedAttemptAuditInput = {
  operation: RejectedAttemptOperation;
  outcome: RejectedAttemptOutcome;
  resourceId: string;
};

const REJECTED_ATTEMPT_OUTCOME_ALLOWLIST: Record<
  RejectedAttemptOperation,
  readonly RejectedAttemptOutcome[]
> = {
  submit: [
    'onboarding_not_found',
    'onboarding_completed',
    'retryable_invalid_data',
    'unknown_workflow_evaluation',
  ],
  manual_review: [
    'onboarding_not_found',
    'onboarding_completed',
    'unsupported_action',
    'transition_unavailable',
    'unknown_workflow_evaluation',
  ],
};

type LifecycleOnboarding = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
};

type LifecycleMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string | null;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
  manualTrigger?: string;
};

type LifecycleAuditInput =
  | {
      action: 'onboarding.started';
      onboarding: LifecycleOnboarding;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.state_transition';
      previousOnboarding: LifecycleOnboarding;
      newOnboarding: LifecycleOnboarding;
      appliedStep: string | null;
    }
  | {
      action: 'onboarding.manual_review_decision';
      previousOnboarding: LifecycleOnboarding;
      newOnboarding: LifecycleOnboarding;
      appliedStep: string | null;
      manualTrigger: string;
    };

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async log(manager: EntityManager, input: LifecycleAuditInput): Promise<unknown> {
    const metadata = this.buildMetadata(input);

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: input.action,
      resourceType: 'onboarding',
      resourceId: this.getResourceId(input),
      metadata: this.filterMetadata(metadata),
      before: this.getBeforeSnapshot(input),
      after: this.getAfterSnapshot(input),
      hashPrev: null,
      hashSelf: null,
    });
  }

  async list(manager: EntityManager, query?: ListAuditQueryDto): Promise<ListAuditResponseDto> {
    const rows = await this.repository.findByFilters(manager, query);

    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: this.filterMetadata(row.metadata as Record<string, unknown>),
      })),
    };
  }

  async logRejectedAttempt(
    dataSource: DataSource,
    input: RejectedAttemptAuditInput,
  ): Promise<unknown> {
    this.assertRejectedAttemptAllowed(input);

    return dataSource.transaction((manager) =>
      this.repository.insert(manager, {
        actorType: 'system',
        actorId: 'engine',
        action: 'onboarding.rejected_attempt',
        resourceType: 'onboarding',
        resourceId: input.resourceId,
        metadata: {
          operation: input.operation,
          outcome: input.outcome,
        },
        before: null,
        after: null,
        hashPrev: null,
        hashSelf: null,
      }),
    );
  }

  private buildMetadata(input: LifecycleAuditInput): LifecycleMetadata {
    if (input.action === 'onboarding.started') {
      return {
        workflowId: input.onboarding.workflowId,
        workflowVersion: input.onboarding.workflowVersion,
        appliedStep: input.appliedStep,
        fromStatus: null,
        toStatus: input.onboarding.status,
        fromCurrentStep: null,
        toCurrentStep: input.onboarding.currentStep,
      };
    }

    if (input.action === 'onboarding.state_transition') {
      return {
        workflowId: input.newOnboarding.workflowId,
        workflowVersion: input.newOnboarding.workflowVersion,
        appliedStep: input.appliedStep,
        fromStatus: input.previousOnboarding.status,
        toStatus: input.newOnboarding.status,
        fromCurrentStep: input.previousOnboarding.currentStep,
        toCurrentStep: input.newOnboarding.currentStep,
      };
    }

    return {
      workflowId: input.newOnboarding.workflowId,
      workflowVersion: input.newOnboarding.workflowVersion,
      appliedStep: input.appliedStep,
      fromStatus: input.previousOnboarding.status,
      toStatus: input.newOnboarding.status,
      fromCurrentStep: input.previousOnboarding.currentStep,
      toCurrentStep: input.newOnboarding.currentStep,
      manualTrigger: input.manualTrigger,
    };
  }

  private getResourceId(input: LifecycleAuditInput): string {
    if (input.action === 'onboarding.started') {
      return input.onboarding.id;
    }

    if (input.action === 'onboarding.state_transition') {
      return input.newOnboarding.id;
    }

    return input.newOnboarding.id;
  }

  private getBeforeSnapshot(input: LifecycleAuditInput): Record<string, unknown> | null {
    if (input.action === 'onboarding.started') {
      return null;
    }

    return this.mapOnboardingSnapshot(input.previousOnboarding);
  }

  private getAfterSnapshot(input: LifecycleAuditInput): Record<string, unknown> | null {
    if (input.action === 'onboarding.started') {
      return this.mapOnboardingSnapshot(input.onboarding);
    }

    return this.mapOnboardingSnapshot(input.newOnboarding);
  }

  private filterMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const safeMetadata: Record<string, unknown> = {
      workflowId: metadata.workflowId,
      workflowVersion: metadata.workflowVersion,
      appliedStep: metadata.appliedStep,
      fromStatus: metadata.fromStatus,
      toStatus: metadata.toStatus,
      fromCurrentStep: metadata.fromCurrentStep,
      toCurrentStep: metadata.toCurrentStep,
    };

    if (metadata.manualTrigger !== undefined) {
      safeMetadata.manualTrigger = metadata.manualTrigger;
    }

    return safeMetadata;
  }

  private mapOnboardingSnapshot(onboarding: LifecycleOnboarding): Record<string, unknown> {
    return {
      id: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status,
      currentStep: onboarding.currentStep,
    };
  }

  private assertRejectedAttemptAllowed(input: RejectedAttemptAuditInput): void {
    const outcomes = REJECTED_ATTEMPT_OUTCOME_ALLOWLIST[input.operation];

    if (!outcomes.includes(input.outcome)) {
      throw new Error(`Unsupported rejected-attempt mapping: ${input.operation}:${input.outcome}`);
    }
  }
}
