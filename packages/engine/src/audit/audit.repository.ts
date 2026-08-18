import { EntityManager } from 'typeorm';
import { paginateQueryBuilder, resolvePaginationWindow, type PaginatedResult } from '../pagination';
import { generateUuidV7 } from '../utils/uuid.util';
import type { AuditOnboardingSnapshot } from './audit.types';
import { ListAuditQueryDto } from './dto/list-audit.query.dto';
import { AuditLogEntity } from './entity/audit-log.entity';

export interface AuditLogInsertInput {
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  before?: AuditOnboardingSnapshot | null;
  after?: AuditOnboardingSnapshot | null;
  hashPrev?: string | null;
  hashSelf?: string | null;
}

export type AuditLogFindByFiltersResult = PaginatedResult<AuditLogEntity>;

export class AuditRepository {
  async insert(manager: EntityManager, input: AuditLogInsertInput): Promise<AuditLogEntity> {
    const repository = manager.getRepository(AuditLogEntity);
    const auditLog = repository.create({
      id: generateUuidV7(),
      occurredAt: new Date(),
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
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
