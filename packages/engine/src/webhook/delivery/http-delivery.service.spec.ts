import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AppConfig } from '../../config/app.config';
import { WebhookOutboxStatus } from '../entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from '../errors/webhook-delivery-failed.exception';
import { WebhookEventPayload, WebhookEventType } from '../webhook-event';
import { WebhookRepository } from '../webhook.repository';
import { HttpDeliveryService } from './http-delivery.service';

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
    const auditService = {
      logWebhook: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditService;

    return {
      service: new HttpDeliveryService(webhookRepository, dataSource, configService, auditService),
      webhookRepository,
      dataSource,
      manager,
      configService,
      auditService,
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
        },
        signal: timeoutSignal,
      }),
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
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      harness.manager,
      expect.objectContaining({
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: claimedEntry.id,
        metadata: expect.objectContaining({ reason: 'lease_expired', status: 'error' }),
      }),
    );
  });

  it('audits a lost claim and returns without attempting delivery', async () => {
    const harness = createHarness();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(null);

    await expect(harness.service.deliverDue('outbox-missing')).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      harness.manager,
      expect.objectContaining({
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: 'outbox-missing',
        metadata: { reason: 'claim_lost' },
      }),
    );
  });

  it('swallows a failed audit write for a lost claim and still returns without attempting delivery', async () => {
    const harness = createHarness();
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(null);
    (harness.auditService.logWebhook as jest.Mock).mockRejectedValue(new Error('insert failed'));

    await expect(harness.service.deliverDue('outbox-missing')).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to record finalization no-op audit for outboxId=outbox-missing',
      ),
    );
  });

  it('audits a delivery-update failure when the delivered-row update cannot be confirmed', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-4',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(false);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.PENDING,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(harness.service.deliverDue(claimedEntry.id)).rejects.toThrow(
      'CLIENT_WEBHOOK_OUTBOX_DELIVERY_UPDATE_FAILED',
    );

    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      harness.manager,
      expect.objectContaining({
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: claimedEntry.id,
        metadata: expect.objectContaining({
          reason: 'delivery_update_failed',
          status: 'pending',
        }),
      }),
    );
  });

  it('audits a state-already-terminal no-op when another worker already finalized the row as delivered', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-5',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(false);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.DELIVERED,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(harness.service.deliverDue(claimedEntry.id)).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_DELIVERY_NOOP outboxId=${claimedEntry.id} reason=state_already_terminal`,
    );
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      harness.manager,
      expect.objectContaining({
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: claimedEntry.id,
        metadata: expect.objectContaining({
          reason: 'state_already_terminal',
          status: 'delivered',
        }),
      }),
    );
  });

  it('audits a finalization-update failure when the failed-row update cannot be confirmed', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-6',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.finalizeFailedClaimFromSending as jest.Mock).mockResolvedValue(null);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.PENDING,
    });
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(harness.service.deliverDue(claimedEntry.id)).rejects.toThrow(
      'CLIENT_WEBHOOK_OUTBOX_FINALIZATION_UPDATE_FAILED',
    );

    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      harness.manager,
      expect.objectContaining({
        action: 'webhook.outbound_finalization_noop',
        resourceType: 'client_webhook_outbox',
        resourceId: claimedEntry.id,
        metadata: expect.objectContaining({
          reason: 'finalization_update_failed',
          status: 'pending',
        }),
      }),
    );
  });

  it('swallows a failed audit write for a lease-expired no-op and still returns without throwing', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-7',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.finalizeFailedClaimFromSending as jest.Mock).mockResolvedValue(null);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.ERROR,
    });
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));
    (harness.auditService.logWebhook as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(harness.service.deliverDue(claimedEntry.id)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Failed to record finalization no-op audit for outboxId=${claimedEntry.id}`,
      ),
    );
  });

  it('swallows a failed audit write for a state-already-terminal no-op and still returns without throwing', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: 'outbox-8',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(false);
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.DELIVERED,
    });
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    (harness.auditService.logWebhook as jest.Mock)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('insert failed'));

    await expect(harness.service.deliverDue(claimedEntry.id)).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        `Failed to record finalization no-op audit for outboxId=${claimedEntry.id}`,
      ),
    );
  });
});
