import { ConfigService } from '@nestjs/config';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { ClientWebhookEventPayload } from './client-webhook-event';
import { ClientWebhookNotifyService } from './client-webhook-notify.service';
import { ClientWebhookOutboxRepository } from './client-webhook-outbox.repository';
import {
  ClientWebhookOutboxEntity,
  ClientWebhookOutboxStatus,
} from './entity/client-webhook-outbox.entity';
import { ClientWebhookDeliveryFailedException } from './errors/client-webhook-delivery-failed.exception';
import { ClientWebhookOutboxNotFoundException } from './errors/client-webhook-outbox-not-found.exception';

describe('ClientWebhookNotifyService', () => {
  const manager = {} as EntityManager;

  const createPayload = (): ClientWebhookEventPayload => ({
    version: 1,
    event: {
      id: '01912345-6789-7abc-8def-0123456789ab',
      type: 'onboarding.state_changed',
      occurredAt: '2026-07-21T10:00:00.000Z',
    },
    onboarding: {
      id: '01912345-6789-7abc-8def-0123456789aa',
      workflowId: 'passport-check',
      workflowVersion: 1,
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      completedAt: null,
    },
  });

  const createOutboxEntity = (status: ClientWebhookOutboxStatus): ClientWebhookOutboxEntity =>
    Object.assign(new ClientWebhookOutboxEntity(), {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: 'onboarding.state_changed',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
      status,
      attempts: 0,
      deliveredAt: null,
    });

  const createHarness = (timeoutMs = 5000) => {
    const dataSource = { manager } as DataSource;
    const outboxRepository = {
      findById: jest.fn(),
      incrementAttemptsForPending: jest.fn(),
      markDelivered: jest.fn(),
    } as unknown as ClientWebhookOutboxRepository;
    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'CLIENT_WEBHOOK_TIMEOUT_MS') {
          return timeoutMs;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>;

    return {
      service: new ClientWebhookNotifyService(dataSource, outboxRepository, configService),
      outboxRepository,
      configService,
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('throws feature-local not-found for unknown id without I/O', async () => {
    const harness = createHarness();
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(null);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.notify('missing-id')).rejects.toBeInstanceOf(
      ClientWebhookOutboxNotFoundException,
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).not.toHaveBeenCalled();
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns explicit no-op for DELIVERED without send or increment', async () => {
    const harness = createHarness();
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(
      createOutboxEntity(ClientWebhookOutboxStatus.DELIVERED),
    );
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.notify('01912345-6789-7abc-8def-0123456789ac')).resolves.toBe(
      undefined,
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).not.toHaveBeenCalled();
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('propagates attempt persistence failure and does not call fetch', async () => {
    const harness = createHarness();
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(
      createOutboxEntity(ClientWebhookOutboxStatus.PENDING),
    );
    const writeError = new Error('write failed');
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockRejectedValue(
      writeError,
    );
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.notify('01912345-6789-7abc-8def-0123456789ac')).rejects.toThrow(
      writeError,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
  });

  it('sends exact POST request snapshot and marks delivered only on 2xx', async () => {
    const harness = createHarness(2500);
    const outbox = createOutboxEntity(ClientWebhookOutboxStatus.PENDING);
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(outbox);
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockResolvedValue(true);
    (harness.outboxRepository.markDelivered as jest.Mock).mockResolvedValue(true);

    const timeoutSignal = new AbortController().signal;
    const abortTimeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const responseText = jest.fn();
    const responseJson = jest.fn();
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      text: responseText,
      json: responseJson,
    } as unknown as Response);

    await harness.service.notify(outbox.id);

    expect(harness.configService.getOrThrow).toHaveBeenCalledWith('CLIENT_WEBHOOK_TIMEOUT_MS');
    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledWith(
      manager,
      outbox.id,
    );
    expect(abortTimeoutSpy).toHaveBeenCalledWith(2500);
    expect(fetchSpy).toHaveBeenCalledWith(outbox.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(outbox.payload),
      signal: timeoutSignal,
    });
    expect(harness.outboxRepository.markDelivered).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.markDelivered).toHaveBeenCalledWith(
      manager,
      outbox.id,
      expect.any(Date),
    );
    expect(responseText).not.toHaveBeenCalled();
    expect(responseJson).not.toHaveBeenCalled();
  });

  it('rejects and keeps PENDING for non-2xx without delivery update', async () => {
    const harness = createHarness();
    const outbox = createOutboxEntity(ClientWebhookOutboxStatus.PENDING);
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(outbox);
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockResolvedValue(true);

    const responseText = jest.fn();
    const responseJson = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      text: responseText,
      json: responseJson,
    } as unknown as Response);

    await expect(harness.service.notify(outbox.id)).rejects.toBeInstanceOf(
      ClientWebhookDeliveryFailedException,
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
    expect(responseText).not.toHaveBeenCalled();
    expect(responseJson).not.toHaveBeenCalled();
  });

  it('rejects and keeps PENDING when fetch rejects', async () => {
    const harness = createHarness();
    const outbox = createOutboxEntity(ClientWebhookOutboxStatus.PENDING);
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(outbox);
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(harness.service.notify(outbox.id)).rejects.toBeInstanceOf(
      ClientWebhookDeliveryFailedException,
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
  });

  it('rejects and keeps PENDING on timeout error', async () => {
    const harness = createHarness();
    const outbox = createOutboxEntity(ClientWebhookOutboxStatus.PENDING);
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(outbox);
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockResolvedValue(true);
    jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new DOMException('The operation was aborted', 'AbortError'));

    await expect(harness.service.notify(outbox.id)).rejects.toBeInstanceOf(
      ClientWebhookDeliveryFailedException,
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.markDelivered).not.toHaveBeenCalled();
  });

  it('propagates failure when delivery update after 2xx cannot be persisted', async () => {
    const harness = createHarness();
    const outbox = createOutboxEntity(ClientWebhookOutboxStatus.PENDING);
    (harness.outboxRepository.findById as jest.Mock).mockResolvedValue(outbox);
    (harness.outboxRepository.incrementAttemptsForPending as jest.Mock).mockResolvedValue(true);
    (harness.outboxRepository.markDelivered as jest.Mock).mockResolvedValue(false);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(harness.service.notify(outbox.id)).rejects.toThrow(
      'CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED',
    );

    expect(harness.outboxRepository.incrementAttemptsForPending).toHaveBeenCalledTimes(1);
    expect(harness.outboxRepository.markDelivered).toHaveBeenCalledTimes(1);
  });
});
