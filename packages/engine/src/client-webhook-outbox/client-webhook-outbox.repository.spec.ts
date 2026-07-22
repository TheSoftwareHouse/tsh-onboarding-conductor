import { EntityManager, Repository, UpdateResult } from 'typeorm';
import { ClientWebhookEventPayload } from './client-webhook-event';
import { ClientWebhookOutboxRepository } from './client-webhook-outbox.repository';
import {
  ClientWebhookOutboxEntity,
  ClientWebhookOutboxStatus,
} from './entity/client-webhook-outbox.entity';

describe('ClientWebhookOutboxRepository', () => {
  const createPayload = (): ClientWebhookEventPayload => ({
    version: 1,
    event: {
      id: '01912345-6789-7abc-8def-0123456789ab',
      type: 'onboarding.created',
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
    const repositoryMock = {
      create: jest.fn(),
      save: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    } as unknown as Repository<ClientWebhookOutboxEntity>;
    const manager = {
      getRepository: jest.fn().mockReturnValue(repositoryMock),
    } as unknown as EntityManager;

    return {
      sut: new ClientWebhookOutboxRepository(),
      manager,
      repositoryMock,
    };
  };

  it('creates a pending outbox entry with zero attempts via caller manager', async () => {
    const harness = createHarness();
    const created = Object.assign(new ClientWebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: 'onboarding.created',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
      status: ClientWebhookOutboxStatus.PENDING,
      attempts: 0,
      deliveredAt: null,
    });
    (harness.repositoryMock.create as jest.Mock).mockReturnValue(created);
    (harness.repositoryMock.save as jest.Mock).mockResolvedValue(created);

    const result = await harness.sut.createPending(harness.manager, {
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: 'onboarding.created',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    });

    expect(harness.manager.getRepository).toHaveBeenCalledWith(ClientWebhookOutboxEntity);
    expect(harness.repositoryMock.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
        status: ClientWebhookOutboxStatus.PENDING,
        attempts: 0,
        deliveredAt: null,
      }),
    );
    expect(harness.repositoryMock.save).toHaveBeenCalledWith(created);
    expect(result).toBe(created);
  });

  it('reads by id via caller manager', async () => {
    const harness = createHarness();
    const existing = Object.assign(new ClientWebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
    });
    (harness.repositoryMock.findOne as jest.Mock).mockResolvedValue(existing);

    const result = await harness.sut.findById(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );

    expect(harness.manager.getRepository).toHaveBeenCalledWith(ClientWebhookOutboxEntity);
    expect(harness.repositoryMock.findOne).toHaveBeenCalledWith({
      where: { id: '01912345-6789-7abc-8def-0123456789ac' },
    });
    expect(result).toBe(existing);
  });

  it('marks delivered via caller manager and reports update outcome', async () => {
    const harness = createHarness();
    const deliveredAt = new Date('2026-07-21T12:00:00.000Z');
    const updatedResult = { affected: 1 } as UpdateResult;
    (harness.repositoryMock.update as jest.Mock).mockResolvedValue(updatedResult);

    const wasUpdated = await harness.sut.markDelivered(
      harness.manager,
      '01912345-6789-7abc-8def-0123456789ac',
      deliveredAt,
    );

    expect(harness.manager.getRepository).toHaveBeenCalledWith(ClientWebhookOutboxEntity);
    expect(harness.repositoryMock.update).toHaveBeenCalledWith(
      { id: '01912345-6789-7abc-8def-0123456789ac' },
      {
        status: ClientWebhookOutboxStatus.DELIVERED,
        deliveredAt,
      },
    );
    expect(wasUpdated).toBe(true);
  });
});
