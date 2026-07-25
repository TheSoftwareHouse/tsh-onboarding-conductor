import { EntityManager, Repository } from 'typeorm';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookRepository } from './webhook.repository';
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
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn(),
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

  it('creates a sending outbox entry via caller manager with initial attempt values', async () => {
    const harness = createHarness();
    const created = Object.assign(new WebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
      status: WebhookOutboxStatus.SENDING,
      attempts: 1,
      deliveredAt: null,
    });
    (harness.repositoryMock.create as jest.Mock).mockReturnValue(created);
    (harness.repositoryMock.save as jest.Mock).mockResolvedValue(created);

    const result = await harness.sut.createSending(harness.manager, {
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    });

    expect(harness.manager.getRepository).toHaveBeenCalledWith(WebhookOutboxEntity);
    expect(harness.repositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        status: WebhookOutboxStatus.SENDING,
        attempts: 1,
        deliveredAt: null,
      }),
    );
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

  it('marks pending from sending and returns false for unmatched transitions', async () => {
    const harness = createHarness();
    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValueOnce({ affected: 1 });

    const wasUpdated = await harness.sut.markPendingFromSending(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(harness.queryBuilderMock.set).toHaveBeenCalledWith({
      status: WebhookOutboxStatus.PENDING,
      deliveredAt: null,
    });
    expect(harness.queryBuilderMock.andWhere).toHaveBeenCalledWith('status = :status', {
      status: WebhookOutboxStatus.SENDING,
    });
    expect(wasUpdated).toBe(true);

    (harness.queryBuilderMock.execute as jest.Mock).mockResolvedValueOnce({ affected: 0 });
    const wasNotUpdated = await harness.sut.markPendingFromSending(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(wasNotUpdated).toBe(false);
  });
});
