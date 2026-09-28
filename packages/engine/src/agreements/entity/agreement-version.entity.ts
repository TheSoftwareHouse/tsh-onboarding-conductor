import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { AgreementEntity } from './agreement.entity';

/**
 * One published version of one agreement family. A version within a family is monotonic from
 * `1`; together with its parent it is unique, and that unique index is also what serves the
 * latest-version lookup a publish and an onboarding start both make (`ORDER BY version DESC
 * LIMIT 1` for an `agreement_id`).
 */
@Entity({ name: 'agreement_versions' })
@Index('uq_agreement_versions_agreement_version', ['agreementId', 'version'], { unique: true })
export class AgreementVersionEntity {
  @PrimaryColumn({ name: 'agreement_version_id', type: 'uuid' })
  agreementVersionId!: string;

  @Column({ name: 'agreement_id', type: 'uuid' })
  agreementId!: string;

  @ManyToOne(() => AgreementEntity, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({
    name: 'agreement_id',
    foreignKeyConstraintName: 'fk_agreement_versions_agreement',
  })
  agreement!: AgreementEntity;

  @Column({ type: 'integer' })
  version!: number;

  @Column({ name: 'published_at', type: 'timestamptz' })
  publishedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
