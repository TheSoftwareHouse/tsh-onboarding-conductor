import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { WorkflowScope } from '../workflow-scope';
import type { WorkflowStatus } from '../workflow-status';

/**
 * One stored workflow revision, keyed by its natural identity: a new revision of
 * a workflow keeps the same `workflow_id` and takes the next `version`, and
 * `status` decides whether that particular revision is served. `definition`
 * keeps the source JSON exactly as it was authored — `json` rather than `jsonb`
 * because the latter reorders object keys and a step's field order is the order
 * clients render it in. It is validated and normalized again on read so the
 * domain never trusts the raw column contents.
 */
@Entity({ name: 'workflows' })
export class WorkflowEntity {
  @PrimaryColumn({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string;

  @PrimaryColumn({ type: 'integer' })
  version!: number;

  @Column({ type: 'varchar', length: 32 })
  scope!: WorkflowScope;

  @Column({ type: 'varchar', length: 16, default: 'published' })
  status!: WorkflowStatus;

  @Column({ type: 'json' })
  definition!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
