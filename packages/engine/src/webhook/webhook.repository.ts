import { EntityManager } from 'typeorm';
import { generateUuidV7 } from '../utils/uuid.util';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookOutboxEntity, WebhookOutboxStatus } from './entity/webhook-outbox.entity';

const DB_CLOCK_NOW_SQL = 'CURRENT_TIMESTAMP';

export interface CreateWebhookOutboxInput {
  onboardingId: string;
  eventType: WebhookEventType;
  endpointUrl: string;
  payload: WebhookEventPayload;
}

export const WEBHOOK_OUTBOX_RETRY_DEFAULTS = Object.freeze({
  maxAttempts: 5,
  baseDelayMs: 5000,
  backoffMultiplier: 2,
  maxBackoffMs: 300_000,
});

export class WebhookRepository {
  async createPending(
    manager: EntityManager,
    input: CreateWebhookOutboxInput,
  ): Promise<WebhookOutboxEntity> {
    const repository = manager.getRepository(WebhookOutboxEntity);
    const outboxEntry = repository.create({
      id: generateUuidV7(),
      onboardingId: input.onboardingId,
      eventType: input.eventType,
      endpointUrl: input.endpointUrl,
      payload: input.payload,
      status: WebhookOutboxStatus.PENDING,
      attempts: 0,
      maxAttempts: WEBHOOK_OUTBOX_RETRY_DEFAULTS.maxAttempts,
      baseDelayMs: WEBHOOK_OUTBOX_RETRY_DEFAULTS.baseDelayMs,
      backoffMultiplier: WEBHOOK_OUTBOX_RETRY_DEFAULTS.backoffMultiplier,
      maxBackoffMs: WEBHOOK_OUTBOX_RETRY_DEFAULTS.maxBackoffMs,
      nextDeliveryAt: new Date(Date.now()),
      sendingStartedAt: null,
      deliveredAt: null,
    });

    return repository.save(outboxEntry);
  }

  async findById(manager: EntityManager, id: string): Promise<WebhookOutboxEntity | null> {
    return manager.getRepository(WebhookOutboxEntity).findOne({ where: { id } });
  }

  async claimPendingForDelivery(
    manager: EntityManager,
    outboxId: string,
    options?: { dueCheck?: boolean },
  ): Promise<WebhookOutboxEntity | null> {
    const queryBuilder = manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.SENDING,
        attempts: () => 'attempts + 1',
        sendingStartedAt: () => DB_CLOCK_NOW_SQL,
        nextDeliveryAt: null,
      })
      .where('id = :id', { id: outboxId })
      .andWhere('status = :status', { status: WebhookOutboxStatus.PENDING })
      .returning('*');

    if (options?.dueCheck) {
      queryBuilder
        .andWhere('next_delivery_at <= CURRENT_TIMESTAMP', {})
        .andWhere('attempts < max_attempts', {});
    }

    const result = await queryBuilder.execute();

    return WebhookOutboxEntity.createFromRaw(this.normalizeClaimedRaw(result.raw));
  }

  async findDuePendingIds(manager: EntityManager, batchSize: number): Promise<string[]> {
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder('outbox')
      .select('outbox.id', 'id')
      .where('outbox.status = :status', { status: WebhookOutboxStatus.PENDING })
      .andWhere('outbox.next_delivery_at <= CURRENT_TIMESTAMP', {})
      .orderBy('outbox.next_delivery_at', 'ASC')
      .addOrderBy('outbox.id', 'ASC')
      .limit(batchSize)
      .getRawMany<{ id: string }>();

    return result.map((row) => row.id);
  }

  async finalizeFailedClaimFromSending(
    manager: EntityManager,
    id: string,
  ): Promise<WebhookOutboxEntity | null> {
    const row = await manager.getRepository(WebhookOutboxEntity).findOne({ where: { id } });
    if (!row) {
      return null;
    }

    const attempts = this.getNumericField(row, 'attempts', 'attempts');
    const maxAttempts = this.getNumericField(row, 'maxAttempts', 'max_attempts');
    const baseDelayMs = this.getNumericField(row, 'baseDelayMs', 'base_delay_ms');
    const backoffMultiplier = this.getNumericField(row, 'backoffMultiplier', 'backoff_multiplier');
    const maxBackoffMs = this.getNumericField(row, 'maxBackoffMs', 'max_backoff_ms');
    const failedAttemptNumber = attempts;
    const nextDeliveryAt =
      attempts >= maxAttempts
        ? null
        : new Date(
            Date.now() +
              this.calculateNextDelayMs(
                baseDelayMs,
                backoffMultiplier,
                maxBackoffMs,
                failedAttemptNumber,
              ),
          );

    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: attempts >= maxAttempts ? WebhookOutboxStatus.ERROR : WebhookOutboxStatus.PENDING,
        deliveredAt: null,
        nextDeliveryAt: attempts >= maxAttempts ? null : nextDeliveryAt,
        sendingStartedAt: null,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WebhookOutboxStatus.SENDING })
      .returning('*')
      .execute();

    return WebhookOutboxEntity.createFromRaw(this.normalizeClaimedRaw(result.raw));
  }

  async expireStaleSendingLeases(
    manager: EntityManager,
    leaseDurationMs: number,
    batchSize: number,
  ): Promise<string[]> {
    const staleIds = await this.findStaleSendingLeaseIds(manager, leaseDurationMs, batchSize);

    if (staleIds.length === 0) {
      return [];
    }

    const { isLeasedPredicate, isStalePredicate } = this.staleSendingLeasePredicates(
      '',
      leaseDurationMs,
    );
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.ERROR,
        sendingStartedAt: null,
        nextDeliveryAt: null,
        deliveredAt: null,
      })
      .where('id IN (:...ids)', { ids: staleIds })
      .andWhere('status = :status', { status: WebhookOutboxStatus.SENDING })
      .andWhere(isLeasedPredicate, {})
      .andWhere(isStalePredicate, {})
      .returning(['id'])
      .execute();

    return this.extractExpiredIds(result.raw);
  }

  private async findStaleSendingLeaseIds(
    manager: EntityManager,
    leaseDurationMs: number,
    batchSize: number,
  ): Promise<string[]> {
    const { isLeasedPredicate, isStalePredicate } = this.staleSendingLeasePredicates(
      'outbox.',
      leaseDurationMs,
    );
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder('outbox')
      .select('outbox.id', 'id')
      .where('outbox.status = :status', { status: WebhookOutboxStatus.SENDING })
      .andWhere(isLeasedPredicate, {})
      .andWhere(isStalePredicate, {})
      .orderBy('outbox.sending_started_at', 'ASC')
      .addOrderBy('outbox.id', 'ASC')
      .limit(batchSize)
      .getRawMany<{ id: string }>();

    return result.map((row) => row.id);
  }

  /**
   * Single source of truth for the stale-sending-lease staleness condition, so the bounded
   * `SELECT` (aliased) and the re-checking `UPDATE` (unaliased) can never drift apart.
   * `columnPrefix` is the query builder's own alias (e.g. `'outbox.'`) or `''` for an unaliased
   * statement.
   */
  private staleSendingLeasePredicates(
    columnPrefix: string,
    leaseDurationMs: number,
  ): { isLeasedPredicate: string; isStalePredicate: string } {
    const sendingStartedAtColumn = `${columnPrefix}sending_started_at`;

    return {
      isLeasedPredicate: `${sendingStartedAtColumn} IS NOT NULL`,
      isStalePredicate: `${sendingStartedAtColumn} < CURRENT_TIMESTAMP - INTERVAL '${leaseDurationMs} milliseconds'`,
    };
  }

  async markDeliveredFromSending(
    manager: EntityManager,
    id: string,
    deliveredAt: Date,
  ): Promise<boolean> {
    const result = await manager
      .getRepository(WebhookOutboxEntity)
      .createQueryBuilder()
      .update(WebhookOutboxEntity)
      .set({
        status: WebhookOutboxStatus.DELIVERED,
        deliveredAt,
        sendingStartedAt: null,
        nextDeliveryAt: null,
      })
      .where('id = :id', { id })
      .andWhere('status = :status', { status: WebhookOutboxStatus.SENDING })
      .execute();

    return (result.affected ?? 0) > 0;
  }

  private calculateNextDelayMs(
    baseDelayMs: number,
    backoffMultiplier: number,
    maxBackoffMs: number,
    attemptNumber: number,
  ): number {
    const backoff = baseDelayMs * Math.pow(backoffMultiplier, attemptNumber - 1);
    return Math.min(backoff, maxBackoffMs);
  }

  private getNumericField(
    row: WebhookOutboxEntity,
    camelCaseField: keyof WebhookOutboxEntity,
    snakeCaseField: string,
  ): number {
    const rowAsRecord = row as unknown as Record<string, unknown>;
    const value = rowAsRecord[camelCaseField as string];
    if (typeof value === 'number') {
      return value;
    }

    const snakeValue = rowAsRecord[snakeCaseField];
    if (typeof snakeValue === 'number') {
      return snakeValue;
    }

    return 0;
  }

  private normalizeClaimedRaw(raw: unknown): Record<string, unknown> | undefined {
    if (!raw) {
      return undefined;
    }

    if (Array.isArray(raw)) {
      return raw[0] as Record<string, unknown> | undefined;
    }

    return raw as Record<string, unknown>;
  }

  private extractExpiredIds(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
      return [];
    }

    return raw
      .map((row) => (row as Record<string, unknown>).id)
      .filter((id): id is string => typeof id === 'string');
  }
}
