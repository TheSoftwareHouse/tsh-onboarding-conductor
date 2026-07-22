import { ConfigService } from '@nestjs/config';
import { EntityManager } from 'typeorm';
import { ClientWebhookEventType } from '../../client-webhook-outbox/client-webhook-event';
import { ClientWebhookOutboxRepository } from '../../client-webhook-outbox/client-webhook-outbox.repository';
import { OnboardingWebhookService } from './onboarding-webhook.service';

describe('OnboardingWebhookService', () => {
  const manager = {} as EntityManager;

  const createHarness = (clientWebhookUrl = 'https://client.example/webhooks/onboarding') => {
    const configService: ConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CLIENT_WEBHOOK_URL') {
          return clientWebhookUrl;
        }

        return undefined;
      }),
    } as unknown as ConfigService;

    const clientWebhookOutboxRepository = {
      createPending: jest.fn().mockImplementation(async (_tx, input) => ({
        id: `outbox-${input.eventType}`,
      })),
    } as unknown as ClientWebhookOutboxRepository;

    return {
      service: new OnboardingWebhookService(configService, clientWebhookOutboxRepository),
      clientWebhookOutboxRepository,
    };
  };

  it('creates a pending onboarding.created outbox event with configured endpoint and payload snapshot', async () => {
    const harness = createHarness();

    const outboxId = await harness.service.createPendingEvent(
      manager,
      ClientWebhookEventType.ONBOARDING_CREATED,
      {
        id: '01912345-6789-7abc-8def-0123456789ab',
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        completedAt: null,
      },
    );

    expect(outboxId).toBe('outbox-onboarding.created');
    expect(harness.clientWebhookOutboxRepository.createPending).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookOutboxRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: '01912345-6789-7abc-8def-0123456789ab',
        eventType: ClientWebhookEventType.ONBOARDING_CREATED,
        endpointUrl: 'https://client.example/webhooks/onboarding',
        payload: {
          version: 1,
          event: {
            id: expect.any(String),
            type: ClientWebhookEventType.ONBOARDING_CREATED,
            occurredAt: expect.any(String),
          },
          onboarding: {
            id: '01912345-6789-7abc-8def-0123456789ab',
            workflowId: 'passport-check',
            workflowVersion: 3,
            status: 'awaiting_user',
            currentStep: 'capture_alias',
            completedAt: null,
          },
        },
      }),
    );
  });

  it('creates a pending onboarding.state_changed event with approved snapshot serialization', async () => {
    const harness = createHarness();

    const outboxId = await harness.service.createPendingEvent(
      manager,
      ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      {
        id: '01912345-6789-7abc-8def-0123456789ab',
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
      },
    );

    expect(outboxId).toBe('outbox-onboarding.state_changed');
    expect(harness.clientWebhookOutboxRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        eventType: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
        payload: {
          version: 1,
          event: {
            id: expect.any(String),
            type: ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
            occurredAt: expect.any(String),
          },
          onboarding: {
            id: '01912345-6789-7abc-8def-0123456789ab',
            workflowId: 'passport-check',
            workflowVersion: 3,
            status: 'approved',
            currentStep: null,
            completedAt: '2026-07-20T10:00:00.000Z',
          },
        },
      }),
    );
  });

  it('returns null and skips outbox persistence when endpoint configuration is absent', async () => {
    const harness = createHarness('');

    const outboxId = await harness.service.createPendingEvent(
      manager,
      ClientWebhookEventType.ONBOARDING_CREATED,
      {
        id: '01912345-6789-7abc-8def-0123456789ab',
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        completedAt: null,
      },
    );

    expect(outboxId).toBeNull();
    expect(harness.clientWebhookOutboxRepository.createPending).not.toHaveBeenCalled();
  });

  it('propagates outbox persistence errors from createPendingEvent', async () => {
    const harness = createHarness();
    const error = new Error('outbox write failed');
    (harness.clientWebhookOutboxRepository.createPending as jest.Mock).mockRejectedValue(error);

    await expect(
      harness.service.createPendingEvent(manager, ClientWebhookEventType.ONBOARDING_CREATED, {
        id: '01912345-6789-7abc-8def-0123456789ab',
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        completedAt: null,
      }),
    ).rejects.toThrow('outbox write failed');

    expect(harness.clientWebhookOutboxRepository.createPending).toHaveBeenCalledTimes(1);
  });
});
