import { EntityManager } from 'typeorm';
import { paginateQueryBuilder, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import {
  ONBOARDING_AUDIT_RESOURCE_TYPE,
  ONBOARDING_TRANSITION_ACTIONS,
  stampAuditEvent,
  type AuditEntryType,
  type AuditEventStamp,
  type AuditOnboardingSnapshot,
} from './audit.types';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { AuditLogEntity } from './entity/audit-log.entity';

export interface AuditLogInsertInput {
  actorType: string;
  actorId: string;
  action: string;
  /**
   * What kind of record this is - the entry type the action declares in its family's table in
   * `audit.types.ts`, passed through by the `AuditService` method that owns that family.
   */
  entryType: AuditEntryType;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  before?: AuditOnboardingSnapshot | null;
  after?: AuditOnboardingSnapshot | null;
  hashPrev?: string | null;
  hashSelf?: string | null;
  /**
   * When the event happened, for a caller whose write is deferred past that moment. Omitted by
   * callers that insert within the event's own transaction, where write time is event time.
   */
  stamp?: AuditEventStamp;
}

export type AuditLogFindByFiltersResult = PaginatedResult<AuditLogEntity>;

export class AuditRepository {
  async insert(manager: EntityManager, input: AuditLogInsertInput): Promise<AuditLogEntity> {
    const repository = manager.getRepository(AuditLogEntity);
    const stamp = input.stamp ?? stampAuditEvent();
    const auditLog = repository.create({
      id: stamp.id,
      occurredAt: stamp.occurredAt,
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entryType: input.entryType,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      before: input.before ?? null,
      after: input.after ?? null,
      metadata: input.metadata,
      hashPrev: input.hashPrev ?? null,
      hashSelf: input.hashSelf ?? null,
    });

    return repository.save(auditLog);
  }

  /**
   * The lifecycle rows of one onboarding, newest first and capped at `limit`.
   *
   * Newest first rather than oldest so that an onboarding with more recorded moves than the cap
   * loses its beginning rather than its end - where it stands now is the part a reader cannot do
   * without. Reading one row beyond the cap is how the caller tells a full trail from a clipped
   * one without a second count query.
   */
  async findOnboardingLifecycle(
    manager: EntityManager,
    onboardingId: string,
    limit: number,
  ): Promise<AuditLogEntity[]> {
    return manager
      .getRepository(AuditLogEntity)
      .createQueryBuilder('audit_log')
      .where('audit_log.resourceType = :resourceType', {
        resourceType: ONBOARDING_AUDIT_RESOURCE_TYPE,
      })
      .andWhere('audit_log.resourceId = :resourceId', { resourceId: onboardingId })
      .andWhere('audit_log.action IN (:...actions)', {
        actions: Object.keys(ONBOARDING_TRANSITION_ACTIONS),
      })
      .orderBy('audit_log.occurredAt', 'DESC')
      .addOrderBy('audit_log.id', 'DESC')
      .take(limit + 1)
      .getMany();
  }

  async findByFilters(
    manager: EntityManager,
    query?: ListAuditQueryDto,
  ): Promise<AuditLogFindByFiltersResult> {
    const repository = manager.getRepository(AuditLogEntity);
    const qb = repository.createQueryBuilder('audit_log');

    if (query?.actorType !== undefined) {
      qb.andWhere('audit_log.actorType = :actorType', { actorType: query.actorType });
    }
    if (query?.actorId !== undefined) {
      qb.andWhere('audit_log.actorId = :actorId', { actorId: query.actorId });
    }
    if (query?.action !== undefined) {
      qb.andWhere('audit_log.action = :action', { action: query.action });
    }
    if (query?.resourceType !== undefined) {
      qb.andWhere('audit_log.resourceType = :resourceType', { resourceType: query.resourceType });
    }
    if (query?.resourceId !== undefined) {
      qb.andWhere('audit_log.resourceId = :resourceId', { resourceId: query.resourceId });
    }
    if (query?.occurredFrom !== undefined) {
      qb.andWhere('audit_log.occurredAt >= :occurredFrom', { occurredFrom: query.occurredFrom });
    }
    if (query?.occurredTo !== undefined) {
      qb.andWhere('audit_log.occurredAt <= :occurredTo', { occurredTo: query.occurredTo });
    }

    qb.orderBy('audit_log.occurredAt', 'DESC').addOrderBy('audit_log.id', 'DESC');

    return paginateQueryBuilder(qb, resolvePaginationWindow(query));
  }
}
