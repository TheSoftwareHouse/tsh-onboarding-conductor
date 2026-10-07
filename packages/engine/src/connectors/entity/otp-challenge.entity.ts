import type { OtpChannelName } from '@tsh/ddl-schema';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { OnboardingEntity } from '../../onboardings/entity/onboarding.entity';

/** One live OTP challenge per onboarding and channel. Holds a salted hash, never the code. */
@Entity({ name: 'otp_challenges' })
@Unique('uq_otp_challenges_onboarding_channel', ['onboardingId', 'channel'])
export class OtpChallengeEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @ManyToOne(() => OnboardingEntity, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'onboarding_id',
    foreignKeyConstraintName: 'fk_otp_challenges_onboarding',
  })
  onboarding!: OnboardingEntity;

  @Column({ type: 'varchar', length: 16 })
  channel!: OtpChannelName;

  @Column({ name: 'code_hash', type: 'char', length: 64 })
  codeHash!: string;

  @Column({ name: 'code_salt', type: 'char', length: 32 })
  codeSalt!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ type: 'int', default: 0 })
  attempts!: number;

  @Column({ name: 'send_count', type: 'int', default: 1 })
  sendCount!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
