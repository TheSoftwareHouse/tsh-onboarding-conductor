import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity({ name: 'onboarding_documents' })
@Index('idx_onboarding_documents_onboarding_id', ['onboardingId'])
export class OnboardingDocumentEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'step_name', type: 'varchar', length: 100 })
  stepName!: string;

  @Column({ name: 'field_name', type: 'varchar', length: 100 })
  fieldName!: string;

  @Column({ type: 'varchar', length: 20 })
  status!: 'pending' | 'completed' | 'expired';

  @Column({ name: 'staging_object_key', type: 'varchar', length: 512 })
  stagingObjectKey!: string;

  @Column({ name: 'final_object_key', type: 'varchar', length: 512, nullable: true })
  finalObjectKey!: string | null;

  @Column({ name: 'requested_content_type', type: 'varchar', length: 255 })
  requestedContentType!: string;

  @Column({ name: 'requested_max_size_bytes', type: 'integer' })
  requestedMaxSizeBytes!: number;

  @Column({ name: 'verified_content_type', type: 'varchar', length: 255, nullable: true })
  verifiedContentType!: string | null;

  @Column({ name: 'verified_size_bytes', type: 'integer', nullable: true })
  verifiedSizeBytes!: number | null;

  @Column({ name: 'verified_etag', type: 'varchar', length: 255, nullable: true })
  verifiedEtag!: string | null;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
