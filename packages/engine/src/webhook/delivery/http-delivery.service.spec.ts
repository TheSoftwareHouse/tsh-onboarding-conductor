import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AppConfig } from '../../config/app.config';
import { WebhookOutboxStatus } from '../entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from '../errors/webhook-delivery-failed.exception';
import { WebhookEventPayload, WebhookEventType } from '../webhook-event';
import { WebhookRepository } from '../webhook.repository';
import { HttpDeliveryService } from './http-delivery.service';
import { WebhookSignatureService } from './webhook-signature.service';

describe('HttpDeliveryService', () => {
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
      currentStep: 'confirm_identity',
      completedAt: null,
    },
  });

  const createHarness = (timeoutMs = 5000) => {
    const manager = {} as never;
    const dataSource = {
      manager,
      transaction: jest.fn(async (callback: (manager: never) => unknown) => callback(manager)),
    } as unknown as DataSource;
    const webhookRepository = {
      claimPendingForDelivery: jest.fn(),
      markDeliveredFromSending: jest.fn(),
      finalizeFailedClaimFromSending: jest.fn(),
      findById: jest.fn(),
    } as unknown as WebhookRepository;
    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'CLIENT_WEBHOOK_TIMEOUT_MS') {
          return timeoutMs;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>;

    const webhookSignatureService = {
      buildHeaders: jest.fn().mockReturnValue({
        'X-Webhook-Timestamp': '1787047200',
        'X-Webhook-Signature': 'v1=deadbeef',
      }),
    } as unknown as WebhookSignatureService;

    return {
      service: new HttpDeliveryService(
        webhookRepository,
        dataSource,
        configService,
        webhookSignatureService,
      ),
      webhookRepository,
      dataSource,
      manager,
      configService,
      webhookSignatureService,
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('claims a due pending row, posts the payload with the stable webhook id header, and marks it delivered', async () => {
    const harness = createHarness(2500);
    const claimedEntry = {
      id: 'outbox-1',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    const timeoutSignal = new AbortController().signal;
    const abortTimeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);

    await harness.service.deliverDue(claimedEntry.id);

    expect(abortTimeoutSpy).toHaveBeenCalledWith(2500);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://client.example/webhooks/onboarding/state-changed',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Event-Id': claimedEntry.payload.event.id,
          'X-Webhook-Timestamp': '1787047200',
          'X-Webhook-Signature': 'v1=deadbeef',
        },
        body: JSON.stringify(claimedEntry.payload),
        signal: timeoutSignal,
      }),
    );
    expect(harness.webhookSignatureService.buildHeaders).toHaveBeenCalledWith(
      JSON.stringify(claimedEntry.payload),
      expect.any(Date),
    );
    expect(harness.webhookRepository.markDeliveredFromSending).toHaveBeenCalledWith(
      harness.manager,
      claimedEntry.id,
      expect.any(Date),
    );
  });

  it('finalizes failed delivery attempts from the database policy for non-2xx responses', async () => {
    const harness = createHarness(5000);
    const claimedEntry = {
      id: 'outbox-2',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.finalizeFailedClaimFromSending as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.PENDING,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(harness.service.deliverDue(claimedEntry.id)).rejects.toBeInstanceOf(
      WebhookDeliveryFailedException,
    );
    expect(harness.webhookRepository.finalizeFailedClaimFromSending).toHaveBeenCalledWith(
      harness.manager,
      claimedEntry.id,
    );
  });

  it('logs a no-op when the claim loses to an expired lease during finalization', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-3',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.finalizeFailedClaimFromSending as jest.Mock).mockResolvedValue(null);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.ERROR,
    });
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(harness.service.deliverDue(claimedEntry.id)).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_FINALIZATION_NOOP outboxId=${claimedEntry.id} reason=lease_expired`,
    );
  });

  it('signs the exact body bytes that are sent', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-signed',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);

    await harness.service.deliverDue(claimedEntry.id);

    const signedBody = (harness.webhookSignatureService.buildHeaders as jest.Mock).mock
      .calls[0][0] as string;
    const sentBody = (fetchSpy.mock.calls[0][1] as RequestInit).body;

    expect(sentBody).toBe(signedBody);
  });
});
