import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

type SubmitTransitionMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string | null;
  fromStatus: string;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
};

type SubmitTransitionOnboarding = {
  id: string;
  workflowId: string;
  workflowVersion: number;
  status: string;
  currentStep: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async log(
    manager: EntityManager,
    previousOnboarding: SubmitTransitionOnboarding,
    newOnboarding: SubmitTransitionOnboarding,
    appliedStep: string | null,
  ): Promise<unknown> {
    const metadata: SubmitTransitionMetadata = {
      workflowId: newOnboarding.workflowId,
      workflowVersion: newOnboarding.workflowVersion,
      appliedStep,
      fromStatus: previousOnboarding.status,
      toStatus: newOnboarding.status,
      fromCurrentStep: previousOnboarding.currentStep,
      toCurrentStep: newOnboarding.currentStep,
    };

    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId: newOnboarding.id,
      metadata: this.filterMetadata(metadata),
      before: this.mapOnboardingSnapshot(previousOnboarding),
      after: this.mapOnboardingSnapshot(newOnboarding),
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
        metadata: this.filterMetadata(row.metadata as SubmitTransitionMetadata),
      })),
    };
  }

  private filterMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    return {
      workflowId: metadata.workflowId,
      workflowVersion: metadata.workflowVersion,
      appliedStep: metadata.appliedStep,
      fromStatus: metadata.fromStatus,
      toStatus: metadata.toStatus,
      fromCurrentStep: metadata.fromCurrentStep,
      toCurrentStep: metadata.toCurrentStep,
    };
  }

  private mapOnboardingSnapshot(onboarding: SubmitTransitionOnboarding): Record<string, unknown> {
    return {
      id: onboarding.id,
      workflowId: onboarding.workflowId,
      workflowVersion: onboarding.workflowVersion,
      status: onboarding.status,
      currentStep: onboarding.currentStep,
    };
  }
}
