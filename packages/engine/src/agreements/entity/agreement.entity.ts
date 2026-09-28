import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { type AgreementType } from '../agreement.types';
import { WorkflowEntity } from '../../workflows/entity/workflow.entity';
import { AgreementVersionEntity } from './agreement-version.entity';

/**
 * One agreement family, identified by `key` — `eu-b2c-terms`. There is deliberately no `name`:
 * `key` and `type` identify the family, and a display label carried on a version row would drift
 * between versions of one family. `type` is a property of the family too — it is constant across
 * its versions, and a publish under an existing `key` with a different `type` is rejected.
 *
 * `workflowId` is nullable: a family may be scoped to one workflow or stay global and resolvable
 * by `key` alone, which is what every family is today. `currentVersionId` names the highest
 * published version; it is set by the same transaction that inserts that version, because
 * agreement versions are only ever created by `POST /v1/admin/agreements` and cannot go stale the
 * way a workflow revision's `status` can.
 */
@Entity({ name: 'agreements' })
@Index('uq_agreements_key', ['key'], { unique: true })
export class AgreementEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 64 })
  type!: AgreementType;

  @Column({ name: 'workflow_id', type: 'uuid', nullable: true })
  workflowId!: string | null;

  @ManyToOne(() => WorkflowEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'workflow_id',
    foreignKeyConstraintName: 'fk_agreements_workflow',
  })
  workflow!: WorkflowEntity | null;

  @Column({ name: 'current_version_id', type: 'uuid', nullable: true })
  currentVersionId!: string | null;

  @ManyToOne(() => AgreementVersionEntity, { onDelete: 'SET NULL' })
  @JoinColumn({
    name: 'current_version_id',
    foreignKeyConstraintName: 'fk_agreements_current_version',
  })
  currentVersion!: AgreementVersionEntity | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
