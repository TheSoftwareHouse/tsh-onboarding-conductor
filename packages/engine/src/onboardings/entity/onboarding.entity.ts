import type { WorkflowStatus } from '@tsh/ddl-schema';
import type { NormalizedWorkflowTransition } from '@tsh/ddl-schema';
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { type ConnectorRejectionReason } from '../../connectors/ports/connector-execution.port';

type OnboardingContext = Record<string, unknown>;

type OnboardingPreMutationWebhookSnapshot = Readonly<{
  status: WorkflowStatus;
  currentStep: string | null;
  completedAt: Date | null;
}>;

@Entity({ name: 'onboardings' })
export class OnboardingEntity {
  #lifecycleTakenTransition?: NormalizedWorkflowTransition;
  #preMutationWebhookSnapshot?: OnboardingPreMutationWebhookSnapshot;

  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'workflow_id', type: 'varchar', length: 100 })
  workflowId!: string;

  @Column({ name: 'workflow_version', type: 'integer' })
  workflowVersion!: number;

  @Column({ type: 'varchar', length: 32 })
  status!: WorkflowStatus;

  @Column({
    name: 'current_step',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  currentStep!: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  context!: OnboardingContext;

  @Column({ name: 'expires_at', type: 'timestamptz', nullable: true })
  expiresAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @Column({ name: 'rejection_reason', type: 'varchar', length: 100, nullable: true })
  rejectionReason!: ConnectorRejectionReason | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  scores!: Record<string, number>;

  isCompleted(): boolean {
    return this.completedAt !== null;
  }

  isApproved(): boolean {
    return this.status === 'approved';
  }

  isRejected(): boolean {
    return this.status === 'rejected';
  }

  setLifecycleTakenTransition(transition: NormalizedWorkflowTransition | undefined): void {
    this.#lifecycleTakenTransition = transition;
  }

  getLifecycleTakenTransition(): NormalizedWorkflowTransition | undefined {
    return this.#lifecycleTakenTransition;
  }

  capturePreMutationWebhookSnapshot(): void {
    this.#preMutationWebhookSnapshot = {
      status: this.status,
      currentStep: this.currentStep,
      completedAt: this.completedAt,
    };
  }

  getPreMutationWebhookSnapshot(): OnboardingPreMutationWebhookSnapshot {
    return (
      this.#preMutationWebhookSnapshot ?? {
        status: this.status,
        currentStep: this.currentStep,
        completedAt: this.completedAt,
      }
    );
  }
}
