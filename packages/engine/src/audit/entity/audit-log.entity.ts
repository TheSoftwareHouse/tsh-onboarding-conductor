import { Column, Entity, PrimaryColumn } from 'typeorm';
import type { AuditEntryType, AuditOnboardingSnapshot } from '../audit.types';

@Entity({ name: 'audit_log' })
export class AuditLogEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'occurred_at', type: 'timestamptz' })
  occurredAt!: Date;

  @Column({ name: 'actor_type', type: 'varchar', length: 64 })
  actorType!: string;

  @Column({ name: 'actor_id', type: 'varchar', length: 255 })
  actorId!: string;

  @Column({ type: 'varchar', length: 255 })
  action!: string;

  /**
   * What kind of record this is: `action` says what happened, this says how it went. Derived from
   * the action by `AuditRepository.insert`, never supplied by a caller, so two call sites writing
   * the same action cannot disagree about its class.
   */
  @Column({ name: 'entry_type', type: 'varchar', length: 16, default: 'success' })
  entryType!: AuditEntryType;

  @Column({ name: 'resource_type', type: 'varchar', length: 64 })
  resourceType!: string;

  @Column({ name: 'resource_id', type: 'varchar', length: 255 })
  resourceId!: string;

  @Column({ type: 'jsonb', nullable: true })
  before!: AuditOnboardingSnapshot | null;

  @Column({ type: 'jsonb', nullable: true })
  after!: AuditOnboardingSnapshot | null;

  @Column({ name: 'metadata', type: 'jsonb' })
  metadata!: Record<string, unknown>;

  @Column({ name: 'hash_prev', type: 'varchar', length: 255, nullable: true })
  hashPrev!: string | null;

  @Column({ name: 'hash_self', type: 'varchar', length: 255, nullable: true })
  hashSelf!: string | null;
}
