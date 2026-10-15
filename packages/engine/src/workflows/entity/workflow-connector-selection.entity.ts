import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { WorkflowEntity } from './workflow.entity';

/** An operator's runtime choice of the connector a step runs, per (family, version, step). */
@Entity({ name: 'workflow_connector_selections' })
export class WorkflowConnectorSelectionEntity {
  @PrimaryColumn({ name: 'workflow_id', type: 'uuid' })
  workflowId!: string;

  @PrimaryColumn({ name: 'version', type: 'integer' })
  version!: number;

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
