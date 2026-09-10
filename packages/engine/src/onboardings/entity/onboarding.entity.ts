import type { WorkflowStatus } from '@tsh/ddl-schema';
import type { NormalizedWorkflowTransition } from '@tsh/ddl-schema';
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import {
  NOT_ACCEPTED_AGREEMENT_STATUS,
  type OnboardingAgreementStatus,
} from '../../agreements/agreement.types';
import { type ConnectorRejectionReason } from '../../connectors/ports/connector-execution.port';
import { OnboardingAgreementStatusView } from './onboarding-agreement-status.view';

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

  /**
   * The derived agreement status, mapped in by the reads that join
   * `onboarding_agreement_statuses`. Not a column: the view computes it, nothing stores it, and
   * an onboarding holding no links at all produces no row there — which is why every reader goes
   * through `getAgreementStatus()` rather than touching this directly.
   */
  agreementStatusView?: OnboardingAgreementStatusView;

  isCompleted(): boolean {
    return this.completedAt !== null;
  }

  isApproved(): boolean {
    return this.status === 'approved';
  }

  isRejected(): boolean {
    return this.status === 'rejected';
  }

  getAgreementStatus(): OnboardingAgreementStatus {
    return this.agreementStatusView?.agreementStatus ?? NOT_ACCEPTED_AGREEMENT_STATUS;
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
