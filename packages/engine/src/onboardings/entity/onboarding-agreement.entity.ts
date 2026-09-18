import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { AgreementVersionEntity } from '../../agreements/entity/agreement-version.entity';
import { type AgreementLinkStatus } from '../../agreements/agreement.types';
import { OnboardingEntity } from './onboarding.entity';

/**
 * One agreement version owed by, or accepted on, one onboarding.
 *
 * The primary key is `(onboarding_id, agreement_version_id)` and not `(onboarding_id, key)` on
 * purpose: an onboarding holds every version of a family it has ever been linked to, so v1
 * `accepted` sitting beside v2 `pending` is representable — that pair *is* the outdated state the
 * `onboarding_agreement_statuses` view derives. Keying by family would overwrite the accepted
 * version and lose which one was actually agreed to.
 *
 * `accepted_at` is set exactly when `status` is `accepted`; the database enforces that pairing,
 * so neither half can be written without the other.
 */
@Entity({ name: 'onboarding_agreements' })
@Index('idx_onboarding_agreements_agreement_version', ['agreementVersionId'])
export class OnboardingAgreementEntity {
  @PrimaryColumn({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @ManyToOne(() => OnboardingEntity, (onboarding) => onboarding.agreements, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'onboarding_id',
    foreignKeyConstraintName: 'fk_onboarding_agreements_onboarding',
  })
  onboarding!: OnboardingEntity;

  @PrimaryColumn({ name: 'agreement_version_id', type: 'uuid' })
  agreementVersionId!: string;

  @ManyToOne(() => AgreementVersionEntity, { onDelete: 'RESTRICT' })
  @JoinColumn({
    name: 'agreement_version_id',
    foreignKeyConstraintName: 'fk_onboarding_agreements_agreement_version',
  })
  agreementVersion!: AgreementVersionEntity;

  @Column({ type: 'varchar', length: 32 })
  status!: AgreementLinkStatus;

  @Column({ name: 'accepted_at', type: 'timestamptz', nullable: true })
  acceptedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
