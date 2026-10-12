import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { WorkflowEntity } from './workflow.entity';

/**
 * An operator's runtime choice of the connector one step of a workflow family runs: the primary
 * connector's `id` on that step is replaced by `connectorId` in every stored version that has the
 * step, while the document itself stays as authored. One row per (family, step), so a step is
 * addressed by name alone — which is why only a step with a single connector slot can be
 * selected. Nothing here proves an adapter with that id is registered: a row naming one a build no
 * longer ships is reported at boot and fails at execution.
 */
@Entity({ name: 'workflow_connector_selections' })
export class WorkflowConnectorSelectionEntity {
  @PrimaryColumn({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @PrimaryColumn({ name: 'step_name', type: 'varchar', length: 100 })
  stepName!: string;

  @ManyToOne(() => WorkflowEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'workflow_id',
    foreignKeyConstraintName: 'fk_workflow_connector_selections_workflow',
  })
  workflow!: WorkflowEntity;

  @Column({ name: 'connector_id', type: 'varchar', length: 64 })
  connectorId!: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'updated_by', type: 'varchar', length: 255, nullable: true })
  updatedBy!: string | null;
}
