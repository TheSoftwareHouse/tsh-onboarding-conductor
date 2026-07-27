import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { WebhookEventPayload, WebhookEventType } from '../webhook-event';

export enum WebhookOutboxStatus {
  PENDING = 'PENDING',
  SENDING = 'SENDING',
  DELIVERED = 'DELIVERED',
}

@Entity({ name: 'client_webhook_outbox' })
export class WebhookOutboxEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

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

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;
}
