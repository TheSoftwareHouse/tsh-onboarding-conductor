import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditRepository } from './audit.repository';
import { ListAuditResponseDto } from './dto/list-audit.response.dto';

type AcceptedSubmitTransitionMetadata = {
  workflowId: string;
  workflowVersion: number;
  appliedStep: string;
  fromStatus: string;
  toStatus: string;
  fromCurrentStep: string | null;
  toCurrentStep: string | null;
};

@Injectable()
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async writeAcceptedSubmitTransition(
    manager: EntityManager,
    resourceId: string,
    metadata: AcceptedSubmitTransitionMetadata,
  ): Promise<unknown> {
    return this.repository.insert(manager, {
      actorType: 'system',
      actorId: 'engine',
      action: 'onboarding.state_transition',
      resourceType: 'onboarding',
      resourceId,
      metadata: this.filterMetadata(metadata),
      before: null,
      after: null,
      hashPrev: null,
      hashSelf: null,
    });
  }

  async list(manager: EntityManager): Promise<ListAuditResponseDto> {
    const rows = await this.repository.findAllOrderedByOccurredAtDescAndIdDesc(manager);

    return {
      items: rows.map((row) => ({
        id: row.id,
        occurredAt: row.occurredAt,
        actorType: row.actorType,
        actorId: row.actorId,
        action: row.action,
        resourceType: row.resourceType,
        resourceId: row.resourceId,
        metadata: this.filterMetadata(row.metadata as AcceptedSubmitTransitionMetadata),
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
}
