import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export type StepHistoryOutcome = 'validation_rejected' | 'transitioned';

export type StepHistoryFieldError = {
  field: string;
  code: string;
};

@Entity({ name: 'step_history' })
export class StepHistoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'applied_step', type: 'varchar', length: 100 })
  appliedStep!: string;

  @Column({ type: 'varchar', length: 32 })
  outcome!: StepHistoryOutcome;

  @Column({ name: 'resulting_status', type: 'varchar', length: 32 })
  resultingStatus!: string;

  @Column({ name: 'resulting_current_step', type: 'varchar', length: 100, nullable: true })
  resultingCurrentStep!: string | null;

  @Column({ name: 'field_errors', type: 'jsonb', nullable: true })
  fieldErrors!: StepHistoryFieldError[] | null;

  @CreateDateColumn({ name: 'recorded_at', type: 'timestamptz' })
  recordedAt!: Date;
}
