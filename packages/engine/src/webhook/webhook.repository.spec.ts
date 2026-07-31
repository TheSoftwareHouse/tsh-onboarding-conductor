import { EntityManager, Repository } from 'typeorm';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookRepository, WEBHOOK_OUTBOX_RETRY_DEFAULTS } from './webhook.repository';
import { WebhookOutboxEntity, WebhookOutboxStatus } from './entity/webhook-outbox.entity';

describe('WebhookRepository', () => {
  const createPayload = (): WebhookEventPayload => ({
    version: 1,
    event: {
      id: '01912345-6789-7abc-8def-0123456789ab',
      type: WebhookEventType.ONBOARDING_STATE_CHANGED,
      occurredAt: '2026-07-21T10:00:00.000Z',
    },
    onboarding: {
      id: '01912345-6789-7abc-8def-0123456789aa',
      workflowId: 'passport-check',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      completedAt: null,
    },
  });

  const createHarness = () => {
    const queryBuilderMock = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(),
      getRawMany: jest.fn(),
    };
    const repositoryMock = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(queryBuilderMock),
    } as unknown as Repository<WebhookOutboxEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return {
      sut: new WebhookRepository(),
      manager,
      repositoryMock,
      queryBuilderMock,
    };
  };

  it('creates a pending outbox intent via caller manager with zero attempts and retry defaults', async () => {
    const harness = createHarness();
    const created = Object.assign(new WebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
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
    (harness.repositoryMock.create as jest.Mock).mockReturnValue(created);
    (harness.repositoryMock.save as jest.Mock).mockResolvedValue(created);

    const before = Date.now();
    const result = await harness.sut.createPending(harness.manager, {
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    });
    const after = Date.now();

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WebhookOutboxEntity);
    expect(harness.repositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        status: WebhookOutboxStatus.PENDING,
        attempts: 0,
        maxAttempts: WEBHOOK_OUTBOX_RETRY_DEFAULTS.maxAttempts,
        baseDelayMs: WEBHOOK_OUTBOX_RETRY_DEFAULTS.baseDelayMs,
        backoffMultiplier: WEBHOOK_OUTBOX_RETRY_DEFAULTS.backoffMultiplier,
        maxBackoffMs: WEBHOOK_OUTBOX_RETRY_DEFAULTS.maxBackoffMs,
        nextDeliveryAt: expect.any(Date),
        sendingStartedAt: null,
        deliveredAt: null,
      }),
    );
    expect(
      (harness.repositoryMock.create as jest.Mock).mock.calls[0][0].nextDeliveryAt.getTime(),
    ).toBeGreaterThanOrEqual(before);
    expect(
      (harness.repositoryMock.create as jest.Mock).mock.calls[0][0].nextDeliveryAt.getTime(),
    ).toBeLessThanOrEqual(after);
    expect(harness.repositoryMock.save).toHaveBeenCalledWith(created);
    expect(result).toBe(created);
  });

  it('reads by id via caller manager', async () => {
    const harness = createHarness();
    const existing = Object.assign(new WebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
    });
    (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(existing);

    const result = await harness.sut.findById(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WebhookOutboxEntity);
    expect(harness.repositoryMock.findOne).toHaveBeenCalledWith({
      where: { id: '01912345-6789-7abc-8def-0123456789ac' },
    });
    expect(result).toBe(existing);
  });

  it('claims a pending row and returns the persisted snapshot', async () => {
    const harness = createHarness();
    const claimedRaw = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboarding_id: '01912345-6789-7abc-8def-0123456789aa',
      event_type: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpoint_url: 'https://client.example/webhooks/onboarding',
      status: WebhookOutboxStatus.SENDING,
      attempts: 2,
      max_attempts: 5,
      base_delay_ms: 5000,
      backoff_multiplier: 2,
      max_backoff_ms: 300000,
      next_delivery_at: null,
      sending_started_at: new Date('2026-07-21T10:01:00.000Z'),
      created_at: new Date('2026-07-21T10:00:00.000Z'),
      updated_at: new Date('2026-07-21T10:01:00.000Z'),
      delivered_at: null,
      payload: createPayload(),
    };
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ raw: [claimedRaw] });

    const result = await harness.sut.claimPendingForDelivery(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WebhookOutboxEntity);
    expect(harness.queryBuilderMock.update).toHaveBeenCalledWith(WebhookOutboxEntity);
    expect(harness.queryBuilderMock.set).toHaveBeenCalledWith({
      status: WebhookOutboxStatus.SENDING,
      attempts: expect.any(Function),
      sendingStartedAt: expect.any(Function),
      nextDeliveryAt: null,
    });
    expect(harness.queryBuilderMock.where).toHaveBeenCalledWith('id = :id', {
      id: '01912345-6789-7abc-8def-0123456789ac',
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenNthCalledWith(1, 'status = :status', {
      status: WebhookOutboxStatus.PENDING,
    });
    expect(harness.queryBuilderMock.returning).toHaveBeenCalledWith('*');
    expect(result).toEqual(
      expect.objectContaining({
        id: claimedRaw.id,
        onboardingId: claimedRaw.onboarding_id,
        eventType: claimedRaw.event_type,
        endpointUrl: claimedRaw.endpoint_url,
        status: claimedRaw.status,
        attempts: claimedRaw.attempts,
        payload: claimedRaw.payload,
        createdAt: claimedRaw.created_at,
        updatedAt: claimedRaw.updated_at,
        deliveredAt: claimedRaw.delivered_at,
      }),
    );
  });

  it('finds a bounded set of due pending ids ordered by due time', async () => {
    const harness = createHarness();
    (harness.queryBuilderMock.getRawMany as jest.Mock).mockResolvedValue([
      { id: 'one' },
      { id: 'two' },
    ]);

    const result = await harness.sut.findDuePendingIds(harness.manager, 25);

    expect(harness.queryBuilderMock.select).toHaveBeenCalledWith('outbox.id', 'id');
    expect(harness.queryBuilderMock.where).toHaveBeenCalledWith('outbox.status = :status', {
      status: WebhookOutboxStatus.PENDING,
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith(
      'outbox.next_delivery_at <= CURRENT_TIMESTAMP',
      {},
    );
    expect(harness.queryBuilderMock.orderBy).toHaveBeenCalledWith('outbox.next_delivery_at', 'ASC');
    expect(harness.queryBuilderMock.addOrderBy).toHaveBeenCalledWith('outbox.id', 'ASC');
    expect(harness.queryBuilderMock.limit).toHaveBeenCalledWith(25);
    expect(result).toEqual(['one', 'two']);
  });

  it('claims due pending rows with a database-clock due guard', async () => {
    const harness = createHarness();
    const claimedRaw = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.SENDING,
      attempts: 1,
      max_attempts: 5,
      base_delay_ms: 5000,
      backoff_multiplier: 2,
      max_backoff_ms: 300000,
      next_delivery_at: null,
      sending_started_at: new Date('2026-07-21T10:01:00.000Z'),
    };
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ raw: [claimedRaw] });

    await harness.sut.claimPendingForDelivery(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
      { dueCheck: true },
    );

    expect(harness.queryBuilderMock.where).toHaveBeenCalledWith('id = :id', {
      id: '01912345-6789-7abc-8def-0123456789ac',
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith('status = :status', {
      status: WebhookOutboxStatus.PENDING,
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith(
      'next_delivery_at <= CURRENT_TIMESTAMP',
      {},
    );
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith('attempts < max_attempts', {});
  });

  it('returns null when a competing claim already moved the row to sending', async () => {
    const harness = createHarness();
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ raw: [] });

    const result = await harness.sut.claimPendingForDelivery(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(result).toBeNull();
  });

  it.each([
    { attempts: 1, expectedDelayMs: 5000 },
    { attempts: 2, expectedDelayMs: 10000 },
    { attempts: 3, expectedDelayMs: 20000 },
    { attempts: 4, expectedDelayMs: 40000 },
  ])(
    'schedules an exact retry delay of $expectedDelayMs ms for a failed attempt $attempts',
    async ({ attempts, expectedDelayMs }) => {
      const harness = createHarness();
      const baseTime = new Date('2026-07-21T10:00:00.000Z').getTime();
      const claimedRaw = {
        id: '01912345-6789-7abc-8def-0123456789ac',
        status: WebhookOutboxStatus.PENDING,
        attempts,
        max_attempts: 5,
        base_delay_ms: 5000,
        backoff_multiplier: 2,
        max_backoff_ms: 300000,
        next_delivery_at: new Date('2026-07-21T10:00:05.000Z'),
        sending_started_at: null,
        delivered_at: null,
      };
      (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(claimedRaw);
      (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ raw: [claimedRaw] });

      const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(baseTime);

      try {
        const result = await harness.sut.finalizeFailedClaimFromSending(
          harness.manager,
          '01912345-6789-7abc-8def-0123456789ac',
        );

        expect(harness.queryBuilderMock.set).toHaveBeenCalledWith(
          expect.objectContaining({
            status: WebhookOutboxStatus.PENDING,
            sendingStartedAt: null,
            deliveredAt: null,
          }),
        );
        expect(
          (harness.queryBuilderMock.set as jest.Mock).mock.calls[0][0].nextDeliveryAt.getTime(),
        ).toBe(baseTime + expectedDelayMs);
        expect(result).toEqual(
          expect.objectContaining({ id: claimedRaw.id, status: claimedRaw.status }),
        );
      } finally {
        nowSpy.mockRestore();
      }
    },
  );

  it('moves a final failed attempt to error instead of rescheduling', async () => {
    const harness = createHarness();
    const claimedRaw = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.ERROR,
      attempts: 5,
      max_attempts: 5,
      base_delay_ms: 5000,
      backoff_multiplier: 2,
      max_backoff_ms: 300000,
      next_delivery_at: null,
      sending_started_at: null,
      delivered_at: null,
    };
    (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(claimedRaw);
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ raw: [claimedRaw] });

    const result = await harness.sut.finalizeFailedClaimFromSending(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(harness.queryBuilderMock.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: WebhookOutboxStatus.ERROR,
        nextDeliveryAt: null,
        sendingStartedAt: null,
        deliveredAt: null,
      }),
    );
    expect(result).toEqual(
      expect.objectContaining({ id: claimedRaw.id, status: claimedRaw.status }),
    );
  });

  it('expires stale sending leases and turns them into error', async () => {
    const harness = createHarness();
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValue({ affected: 2 });

    const affected = await harness.sut.expireStaleSendingLeases(harness.manager, 60_000);

    expect(harness.queryBuilderMock.set).toHaveBeenCalledWith({
      status: WebhookOutboxStatus.ERROR,
      sendingStartedAt: null,
      nextDeliveryAt: null,
      deliveredAt: null,
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith(
      'sending_started_at IS NOT NULL',
      {},
    );
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith(
      "sending_started_at < CURRENT_TIMESTAMP - INTERVAL '60000 milliseconds'",
      {},
    );
    expect(affected).toBe(2);
  });

  it('marks delivered from sending and returns false when no row matched', async () => {
    const harness = createHarness();
    const deliveredAt = new Date('2026-07-21T12:00:00.000Z');
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValueOnce({ affected: 1 });

    const wasUpdated = await harness.sut.markDeliveredFromSending(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
      deliveredAt,
    );

    expect(harness.queryBuilderMock.set).toHaveBeenCalledWith({
      status: WebhookOutboxStatus.DELIVERED,
      deliveredAt,
      sendingStartedAt: null,
      nextDeliveryAt: null,
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith('status = :status', {
      status: WebhookOutboxStatus.SENDING,
    });
    expect(wasUpdated).toBe(true);

    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValueOnce({ affected: 0 });
    const wasNotUpdated = await harness.sut.markDeliveredFromSending(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
      deliveredAt,
    );

    expect(wasNotUpdated).toBe(false);
  });
});
