import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * One workflow family, identified by `name`. `name` holds the workflow document's
 * `id` — `eu-b2c-individual-kyc-eea` — the only string a workflow document declares
 * that stays the same across every one of its revisions, and the only name a
 * workflow has: the document's separate prose `name` field does not exist any
 * more. It is what `POST /v1/onboardings` and `GET /v1/admin/workflows/:workflowId`
 * take as `workflowId`, and what the startup upsert matches a file to its row by.
 *
 * `workflow_id` is a surrogate uuid, generated the first time a name is seen and
 * left untouched by every later revision of that name — it exists so a revision
 * (`WorkflowVersionEntity`) has a stable parent to point at.
 */
@Entity({ name: 'workflows' })
@Index('uq_workflows_name', ['name'], { unique: true })
export class WorkflowEntity {
  @PrimaryColumn({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
