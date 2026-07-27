import { EntityManager } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { AuditLogEntity } from './entity/audit-log.entity';

export interface AuditLogInsertInput {
  actorType: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  hashPrev?: string | null;
  hashSelf?: string | null;
}

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

  async findAllOrderedByOccurredAtDescAndIdDesc(manager: EntityManager): Promise<AuditLogEntity[]> {
    return manager.getRepository(AuditLogEntity).find({
      order: {
        occurredAt: 'DESC',
        id: 'DESC',
      },
    });
  }
}
