import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OnboardingEntity } from './onboarding.entity';

const safeNumberTransformer = {
  to(value: number | null | undefined): number | null | undefined {
    if (value === null || value === undefined) {
      return value;
    }

    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Value ${value} exceeds the JavaScript safe integer range`);
    }

    return value;
  },
  from(value: number | string | null | undefined): number | null | undefined {
    if (value === null || value === undefined) {
      return value as null | undefined;
    }

    if (typeof value === 'string') {
      const parsedValue = Number(value);

      if (!Number.isSafeInteger(parsedValue)) {
        throw new RangeError(`Value ${value} exceeds the JavaScript safe integer range`);
      }

      return parsedValue;
    }

    if (!Number.isSafeInteger(value)) {
      throw new RangeError(`Value ${value} exceeds the JavaScript safe integer range`);
    }

    return value;
  },
} as const;

@Entity({ name: 'onboarding_documents' })
@Index('idx_onboarding_documents_onboarding_id', ['onboardingId'])
export class OnboardingDocumentEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @ManyToOne(() => OnboardingEntity, (onboarding) => onboarding.documents, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'onboarding_id',
    foreignKeyConstraintName: 'fk_onboarding_documents_onboarding',
  })
  onboarding!: OnboardingEntity;

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

  @Column({
    name: 'requested_max_size_bytes',
    type: 'bigint',
    transformer: safeNumberTransformer,
  })
  requestedMaxSizeBytes!: number;

  @Column({ name: 'verified_content_type', type: 'varchar', length: 255, nullable: true })
  verifiedContentType!: string | null;

  @Column({
    name: 'verified_size_bytes',
    type: 'bigint',
    nullable: true,
    transformer: safeNumberTransformer,
  })
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
