import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import type { WorkflowScope } from '../workflow-scope';

/**
 * One workflow family, identified by `key`. `key` holds the workflow document's `id` —
 * `eu-b2c-individual-kyc-eea` — the only string a document declares that stays the same across
 * every one of its revisions. It is what `POST /v1/onboardings` and
 * `GET /v1/admin/workflows/:workflowId` take as `workflowId`, and what the startup publish matches
 * a file to its row by; `agreements.key` names an agreement family the same way.
 *
 * `name` is the family's display label — the optional root `name` a document declares — and is
 * nullable because a document need not declare one. The publish writes it from the highest version
 * it stores that declares one, so the label reads as the newest revision's, and a document without
 * one leaves whatever the family already carries. Nothing resolves a workflow by it.
 *
 * `scope` is the scope directory whose file created the family, and every revision inherits it: a
 * family belongs to exactly one scope, so a file under another scope that reuses the key is refused
 * at boot (`WorkflowScopeConflictError`) rather than joining the family. A shipped flow is forked
 * under an id of its own, never patched from `users/`. Every read filters through it, which is how
 * production hides the `fixtures` families.
 *
 * `workflow_id` is a surrogate uuid, generated the first time a key is seen and left untouched by
 * every later revision of that key — it exists so a revision (`WorkflowVersionEntity`) has a
 * stable parent to point at.
 */
@Entity({ name: 'workflows' })
@Index('uq_workflows_key', ['key'], { unique: true })
export class WorkflowEntity {
  @PrimaryColumn({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @Column({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 32 })
  scope!: WorkflowScope;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
