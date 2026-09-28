import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { WorkflowStatus } from '../workflow-status';
import { WorkflowEntity } from './workflow.entity';

/**
 * One stored workflow revision, keyed by its own uuid and pointing at the
 * workflow family (`WorkflowEntity`) it belongs to. A new revision of a workflow
 * keeps the same parent and takes the next `version`, and `status` decides
 * whether that particular revision is served; its scope is its family's. `definition` keeps the source JSON
 * exactly as it was authored — `json` rather than `jsonb` because the latter
 * reorders object keys and a step's field order is the order clients render it
 * in. It is validated and normalized again on read so the domain never trusts
 * the raw column contents.
 */
@Entity({ name: 'workflow_versions' })
export class WorkflowVersionEntity {
  @PrimaryColumn({ name: 'workflow_version_id', type: 'uuid' })
  workflowVersionId!: string;

  @Column({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @ManyToOne(() => WorkflowEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'workflow_id',
    foreignKeyConstraintName: 'fk_workflow_versions_workflow',
  })
  workflow!: WorkflowEntity;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 16, default: 'published' })
  status!: WorkflowStatus;

  @Column({ type: 'json' })
  definition!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
