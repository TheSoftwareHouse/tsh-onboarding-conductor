import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OnboardingEntity } from '../../onboardings/entity/onboarding.entity';
import { WebhookEventPayload, WebhookEventType } from '../webhook-event';

export enum WebhookOutboxStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  DELIVERED = 'DELIVERED',
  ERROR = 'ERROR',
}

@Entity({ name: 'client_webhook_outbox' })
export class WebhookOutboxEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  // Intentionally unenforced: the outbox is an independent delivery ledger and must not be
  // deleted by an onboarding's lifecycle.
  @ManyToOne(() => OnboardingEntity, { createForeignKeyConstraints: false })
  @JoinColumn({ name: 'onboarding_id' })
  onboarding!: OnboardingEntity;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: WebhookEventType;

  @Column({ name: 'endpoint_url', type: 'text' })
  endpointUrl!: string;

  @Column({ type: 'jsonb' })
  payload!: WebhookEventPayload;

  @Column({ type: 'varchar', length: 16, default: WebhookOutboxStatus.PENDING })
  status!: WebhookOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @Column({ name: 'max_attempts', type: 'integer', default: 5 })
  maxAttempts!: number;

  @Column({ name: 'base_delay_ms', type: 'integer', default: 5000 })
  baseDelayMs!: number;

  @Column({ name: 'backoff_multiplier', type: 'integer', default: 2 })
  backoffMultiplier!: number;

  @Column({ name: 'max_backoff_ms', type: 'integer', default: 300000 })
  maxBackoffMs!: number;

  @Column({ name: 'next_delivery_at', type: 'timestamptz', nullable: true })
  nextDeliveryAt!: Date | null;

  @Column({ name: 'sending_started_at', type: 'timestamptz', nullable: true })
  sendingStartedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;

  static createFromRaw(raw: Record<string, unknown> | undefined): WebhookOutboxEntity | null {
    if (!raw) {
      return null;
    }

    const entity = new WebhookOutboxEntity();

    if (raw.id !== undefined) {
      entity.id = raw.id as string;
    }
    if (raw.onboarding_id !== undefined) {
      entity.onboardingId = raw.onboarding_id as string;
    }
    if (raw.event_type !== undefined) {
      entity.eventType = raw.event_type as WebhookEventType;
    }
    if (raw.endpoint_url !== undefined) {
      entity.endpointUrl = raw.endpoint_url as string;
    }
    if (raw.payload !== undefined) {
      entity.payload = raw.payload as WebhookEventPayload;
    }
    if (raw.status !== undefined) {
      entity.status = raw.status as WebhookOutboxStatus;
    }
    if (raw.attempts !== undefined) {
      entity.attempts = raw.attempts as number;
    }
    if (raw.max_attempts !== undefined) {
      entity.maxAttempts = raw.max_attempts as number;
    }
    if (raw.base_delay_ms !== undefined) {
      entity.baseDelayMs = raw.base_delay_ms as number;
    }
    if (raw.backoff_multiplier !== undefined) {
      entity.backoffMultiplier = raw.backoff_multiplier as number;
    }
    if (raw.max_backoff_ms !== undefined) {
      entity.maxBackoffMs = raw.max_backoff_ms as number;
    }
    if (raw.next_delivery_at !== undefined) {
      entity.nextDeliveryAt = raw.next_delivery_at as Date | null;
    }
    if (raw.sending_started_at !== undefined) {
      entity.sendingStartedAt = raw.sending_started_at as Date | null;
    }
    if (raw.created_at !== undefined) {
      entity.createdAt = raw.created_at as Date;
    }
    if (raw.updated_at !== undefined) {
      entity.updatedAt = raw.updated_at as Date;
    }
    if (raw.delivered_at !== undefined) {
      entity.deliveredAt = raw.delivered_at as Date | null;
    }

    return entity;
  }
}
