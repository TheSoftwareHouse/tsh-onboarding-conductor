import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ClientWebhookEventPayload, ClientWebhookEventType } from '../client-webhook-event';

export enum ClientWebhookOutboxStatus {
  PENDING = 'PENDING',
  DELIVERED = 'DELIVERED',
}

@Entity({ name: 'client_webhook_outbox' })
export class ClientWebhookOutboxEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'onboarding_id', type: 'uuid' })
  onboardingId!: string;

  @Column({ name: 'event_type', type: 'varchar', length: 64 })
  eventType!: ClientWebhookEventType;

  @Column({ name: 'endpoint_url', type: 'text' })
  endpointUrl!: string;

  @Column({ type: 'jsonb' })
  payload!: ClientWebhookEventPayload;

  @Column({ type: 'varchar', length: 16, default: ClientWebhookOutboxStatus.PENDING })
  status!: ClientWebhookOutboxStatus;

  @Column({ type: 'integer', default: 0 })
  attempts!: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @Column({ name: 'delivered_at', type: 'timestamptz', nullable: true })
  deliveredAt!: Date | null;
}
