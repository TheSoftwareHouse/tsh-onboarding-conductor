import { BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkflowStatus } from '@tsh/ddl-schema';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import type { ConnectorExecutionPort } from '../connectors/ports/connector-execution.port';
import { OnboardingEntity } from '../onboardings/entity/onboarding.entity';
import { Workflow } from '../workflows/domain/workflow';
import { WebhookOutboxStatus } from './entity/webhook-outbox.entity';
import { WebhookDeliveryFailedException } from './errors/webhook-delivery-failed.exception';
import { WebhookOutboxNotFoundException } from './errors/webhook-outbox-not-found.exception';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookRepository } from './webhook.repository';
import { WebhookService } from './webhook.service';

describe('WebhookService', () => {
  const manager = {} as EntityManager;

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

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
    Object.assign(new OnboardingEntity(), {
      id: '01912345-6789-7abc-8def-0123456789aa',
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user' as WorkflowStatus,
      currentStep: 'capture_alias',
      completedAt: null,
      ...overrides,
    });

  const createWorkflow = (overrides?: {
    rootPath?: string;
    effectivePath?: string;
    disableEffective?: boolean;
  }): Workflow => {
    const rootPath = overrides?.rootPath ?? 'state-changed';
    const effectivePath = overrides?.effectivePath;
    const disableEffective = overrides?.disableEffective ?? false;

    return {
      getRootNotifyWebhook: jest.fn().mockReturnValue(rootPath ? { path: rootPath } : undefined),
      getEffectiveNotifyWebhookForTransition: jest.fn().mockImplementation(() => {
        if (disableEffective) {
          return undefined;
        }

        if (!effectivePath) {
          return { path: rootPath };
        }

        return { path: effectivePath };
      }),
    } as unknown as Workflow;
  };

  const createHarness = (
    timeoutMs = 5000,
    transactionManager: EntityManager = manager,
    dataSourceManager: EntityManager = manager,
    connectorExecutionPort?: ConnectorExecutionPort,
  ) => {
    const dataSource = {
      manager: dataSourceManager,
      transaction: jest.fn(async (callback: (manager: EntityManager) => unknown) =>
        callback(transactionManager),
      ),
    } as unknown as DataSource;
    const webhookRepository = {
      createPending: jest.fn(),
      findById: jest.fn(),
      claimPendingForDelivery: jest.fn(),
      markDeliveredFromSending: jest.fn(),
      markPendingFromSending: jest.fn(),
    } as unknown as WebhookRepository;
    const clientWebhookUrlResolver = {
      resolve: jest.fn(),
    } as unknown as ClientWebhookUrlResolver;
    const configService = {
      getOrThrow: jest.fn().mockImplementation((key: string) => {
        if (key === 'CLIENT_WEBHOOK_TIMEOUT_MS') {
          return timeoutMs;
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>;

    return {
      service: new WebhookService(
        webhookRepository,
        clientWebhookUrlResolver,
        dataSource,
        configService,
        connectorExecutionPort,
      ),
      webhookRepository,
      clientWebhookUrlResolver,
      configService,
      transactionManager,
    };
  };

  const invokeDeliver = (service: WebhookService, outboxId: string): Promise<void> =>
    (
      service as unknown as {
        deliver: (targetOutboxId: string) => Promise<void>;
      }
    ).deliver(outboxId);

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('no-ops notify for undefined effective webhook declaration', async () => {
    const harness = createHarness();
    const workflow = createWorkflow({ rootPath: '' });

    await expect(harness.service.notify(createOnboarding(), workflow)).resolves.toBeUndefined();

    expect(harness.clientWebhookUrlResolver.resolve).not.toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).not.toHaveBeenCalled();
  });

  it('uses pre-mutation snapshot and root declaration in notifyError', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      completedAt: null,
    });
    const workflow = createWorkflow({ rootPath: 'state-changed' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    onboarding.capturePreMutationWebhookSnapshot();
    onboarding.status = 'approved';
    onboarding.currentStep = null;
    onboarding.completedAt = new Date('2026-07-22T10:00:00.000Z');

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow);

    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
        payload: expect.objectContaining({
          onboarding: expect.objectContaining({
            status: 'awaiting_user',
            currentStep: 'capture_alias',
            completedAt: null,
          }),
        }),
      }),
    );
  });

  it('no-ops notifyError when root declaration is absent', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding();
    const workflow = createWorkflow({ rootPath: '' });
    onboarding.capturePreMutationWebhookSnapshot();

    await expect(
      harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow),
    ).resolves.toBeUndefined();

    expect(harness.clientWebhookUrlResolver.resolve).not.toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).not.toHaveBeenCalled();
  });

  it('delegates notifyError to outbox enqueue/delivery when root declaration is available', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding();
    const workflow = createWorkflow({ rootPath: 'state-changed' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    onboarding.capturePreMutationWebhookSnapshot();

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(
      harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow),
    ).resolves.toBeUndefined();

    expect(harness.webhookRepository.createPending).toHaveBeenCalledTimes(1);
  });

  it('creates a PENDING notification intent and immediately calls delivery orchestration', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue({
      id: outboxEntry.id,
      endpointUrl: outboxEntry.endpointUrl,
      payload: outboxEntry.payload,
    });
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.clientWebhookUrlResolver.resolve).toHaveBeenCalledWith('state-changed');
    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      }),
    );
    expect(harness.webhookRepository.claimPendingForDelivery).toHaveBeenCalledWith(
      manager,
      outboxEntry.id,
    );
  });

  it('contains immediate delivery failures in notify', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();
    expect(harness.webhookRepository.markPendingFromSending).toHaveBeenCalledWith(
      manager,
      outboxEntry.id,
    );
  });

  it('contains PENDING intent creation failures in notify', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockRejectedValue(
      new Error('create pending failed'),
    );

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      }),
    );
    expect(harness.webhookRepository.claimPendingForDelivery).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id} reason=create pending failed`,
    );
  });

  it('claims PENDING intent and marks it DELIVERED on 2xx response', async () => {
    const harness = createHarness(2500, manager, manager);
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    const timeoutSignal = new AbortController().signal;
    const abortTimeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await invokeDeliver(harness.service, claimedEntry.id);

    expect(abortTimeoutSpy).toHaveBeenCalledWith(2500);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://client.example/webhooks/onboarding/state-changed',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: timeoutSignal,
      }),
    );
    expect(harness.webhookRepository.markDeliveredFromSending).toHaveBeenCalledWith(
      manager,
      claimedEntry.id,
      expect.any(Date),
    );
  });

  it('restores SENDING to PENDING and throws delivery failure for non-2xx responses', async () => {
    const harness = createHarness(5000, manager, manager);
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(invokeDeliver(harness.service, claimedEntry.id)).rejects.toBeInstanceOf(
      WebhookDeliveryFailedException,
    );

    expect(harness.webhookRepository.markPendingFromSending).toHaveBeenCalledWith(
      manager,
      claimedEntry.id,
    );
  });

  it('surfaces pending-restore failures after delivery failure', async () => {
    const harness = createHarness(5000, manager, manager);
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(false);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(invokeDeliver(harness.service, claimedEntry.id)).rejects.toThrow(
      'CLIENT_WEBHOOK_OUTBOX_PENDING_RESTORE_FAILED',
    );
  });

  it('throws feature-local not-found for unknown resend ids without I/O', async () => {
    const harness = createHarness();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue(null);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.resend('missing-id')).rejects.toBeInstanceOf(
      WebhookOutboxNotFoundException,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('skips resend for DELIVERED or SENDING outbox rows', async () => {
    const harness = createHarness();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'delivered-id',
      status: WebhookOutboxStatus.DELIVERED,
    });
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'sending-id',
      status: WebhookOutboxStatus.SENDING,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.resend('delivered-id')).resolves.toBeUndefined();
    await expect(harness.service.resend('sending-id')).resolves.toBeUndefined();
    expect(harness.webhookRepository.claimPendingForDelivery).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('claims a PENDING row and reuses the shared delivery helper for a resend', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.PENDING,
    });
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();

    expect(harness.webhookRepository.claimPendingForDelivery).toHaveBeenCalledWith(
      manager,
      '01912345-6789-7abc-8def-0123456789ac',
    );
    expect(harness.webhookRepository.markDeliveredFromSending).toHaveBeenCalledWith(
      manager,
      claimedEntry.id,
      expect.any(Date),
    );
  });

  it('treats a lost PENDING claim as a successful no-op for resend', async () => {
    const harness = createHarness();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.PENDING,
    });
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(null);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(harness.webhookRepository.markDeliveredFromSending).not.toHaveBeenCalled();
  });

  it('restores PENDING and surfaces delivery failures from resend', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
    };
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.PENDING,
    });
    (harness.webhookRepository.claimPendingForDelivery as jest.Mock).mockResolvedValue(
      claimedEntry,
    );
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network error'));

    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).rejects.toBeInstanceOf(WebhookDeliveryFailedException);
    expect(harness.webhookRepository.markPendingFromSending).toHaveBeenCalledWith(
      manager,
      claimedEntry.id,
    );
  });

  describe('process', () => {
    it('delegates validation and mapping to the resolved adapter and returns the normalized triplet', async () => {
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn(),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);
      const mapCallbackResult = jest.fn().mockResolvedValue({
        onboardingId: 'onboarding-1',
        submittedData: { acceptedTerms: true },
        resolvedConnector: { connectorOrder: 2 },
        result: ConnectorExecutionResult.accepted(),
      });

      connectorExecutionPort.findAdapterByType.mockReturnValue({
        name: 'mock_async_callback',
        type: 'mock_async_callback',
        supportsAsyncCallback: true,
        execute: jest.fn(),
        mapCallbackResult,
      });

      await expect(
        harness.service.process(manager, {
          providerKey: 'mock_async_callback',
          rawBody: new Uint8Array([1, 2, 3]),
          headers: { 'X-Test': 'value' },
        }),
      ).resolves.toEqual({
        onboardingId: 'onboarding-1',
        submittedData: { acceptedTerms: true },
        resolvedConnector: {
          connectorOrder: 2,
          result: ConnectorExecutionResult.accepted(),
        },
      });

      expect(mapCallbackResult).toHaveBeenCalledWith({
        rawBody: expect.any(Uint8Array),
        headers: { 'x-test': 'value' },
      });
    });

    it('rejects malformed provider keys before adapter resolution', async () => {
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn(),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);

      await expect(
        harness.service.process(manager, {
          providerKey: 'MOCK-ASYNC-CALLBACK',
          rawBody: new Uint8Array([1]),
          headers: {},
        }),
      ).rejects.toBeInstanceOf(BadRequestException);

      expect(connectorExecutionPort.findAdapterByType).not.toHaveBeenCalled();
    });

    it('fails closed when callback adapter resolution fails', async () => {
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockImplementation(() => {
          throw new Error('missing adapter');
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);

      await expect(
        harness.service.process(manager, {
          providerKey: 'mock_async_callback',
          rawBody: new Uint8Array([1]),
          headers: {},
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });
});
