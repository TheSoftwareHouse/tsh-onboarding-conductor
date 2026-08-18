import { createHmac } from 'node:crypto';
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
import { CallbackSignatureVerifier } from './callback-signature/callback-signature.verifier';
import { CallbackSignatureInvalidException } from './errors/callback-signature-invalid.exception';
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookOutboxNotFoundException } from './errors/webhook-outbox-not-found.exception';
import { WebhookOutboxStatus } from './entity/webhook-outbox.entity';
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

  const createCallbackSignatureVerifier = (
    callbackSecrets: Record<string, string | readonly string[]> = {},
  ) =>
    new CallbackSignatureVerifier({
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'CONNECTOR_CALLBACK_SIGNING_SECRETS') {
          return JSON.stringify(callbackSecrets);
        }

        if (key === 'CONNECTOR_CALLBACK_UNSIGNED_TYPES') {
          return '';
        }

        if (key === 'NODE_ENV') {
          return 'test';
        }

        throw new Error(`Unexpected config key: ${key}`);
      }),
    } as unknown as ConfigService<AppConfig, true>);

  const createHarness = (
    timeoutMs = 5000,
    transactionManager: EntityManager = manager,
    dataSourceManager: EntityManager = manager,
    connectorExecutionPort?: ConnectorExecutionPort,
    callbackSignatureVerifier: CallbackSignatureVerifier = createCallbackSignatureVerifier(),
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
      finalizeFailedClaimFromSending: jest.fn(),
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

    const auditService = {
      logWebhook: jest.fn().mockResolvedValue(undefined),
    };
    const webhookQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };

    return {
      service: new WebhookService(
        webhookRepository,
        clientWebhookUrlResolver,
        dataSource,
        configService,
        webhookQueueService as never,
        callbackSignatureVerifier,
        connectorExecutionPort,
        auditService as never,
      ),
      dataSource,
      webhookRepository,
      clientWebhookUrlResolver,
      configService,
      webhookQueueService,
      transactionManager,
      auditService,
    };
  };

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

  it('logs suppression diagnostic instead of persisting a suppression audit when no webhook declaration is configured', async () => {
    const harness = createHarness();
    const workflow = createWorkflow({ rootPath: '' });
    const onboarding = createOnboarding();
    const loggerSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.auditService.logWebhook).not.toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_notification_suppressed',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} operation=notify reason=no_configured_webhook`,
    );
  });

  it('logs suppression diagnostic for notifyError when no root webhook declaration is configured', async () => {
    const harness = createHarness();
    const workflow = createWorkflow({ rootPath: '' });
    const onboarding = createOnboarding();
    const loggerSpy = jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    onboarding.capturePreMutationWebhookSnapshot();

    await expect(
      harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow),
    ).resolves.toBeUndefined();

    expect(harness.auditService.logWebhook).not.toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_notification_suppressed',
      }),
    );
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_NOTIFICATION_SUPPRESSED onboardingId=${onboarding.id} operation=notify_error reason=no_configured_webhook`,
    );
  });

  it('uses pre-mutation snapshot and root declaration in notifyError', async () => {
    const transactionManager = { id: 'transaction-manager' } as unknown as EntityManager;
    const dataSourceManager = { id: 'data-source-manager' } as unknown as EntityManager;
    const harness = createHarness(5000, transactionManager, dataSourceManager);
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

    await harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow);

    expect(harness.dataSource.transaction).toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      transactionManager,
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

    await expect(
      harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow),
    ).resolves.toBeUndefined();

    expect(harness.webhookRepository.createPending).toHaveBeenCalledTimes(1);
  });

  it('creates a PENDING notification intent transactionally and preserves immediate delivery', async () => {
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

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.clientWebhookUrlResolver.resolve).toHaveBeenCalledWith('state-changed');
    expect(harness.dataSource.transaction).toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      }),
    );
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_intent_created',
        resourceType: 'client_webhook_outbox',
        resourceId: outboxEntry.id,
        metadata: expect.objectContaining({
          payload: outboxEntry.payload,
        }),
      }),
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
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id} reason=create pending failed`,
    );
  });

  it('logs and no-ops notify when optional webhook configuration is invalid', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockImplementation(() => {
      throw new Error('CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured');
    });

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.webhookRepository.createPending).not.toHaveBeenCalled();
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_PERSISTENCE_FAILED onboardingId=${onboarding.id} reason=CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured`,
    );
  });

  it('propagates resend observation audit persistence failures', async () => {
    const harness = createHarness();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue(null);
    (harness.auditService.logWebhook as jest.Mock)
      .mockRejectedValueOnce(new Error('audit failed'))
      .mockRejectedValueOnce(new Error('audit failed'));

    await expect(harness.service.resend('missing-id')).rejects.toThrow('audit failed');
  });

  it('throws when resending a missing outbox row', async () => {
    const harness = createHarness();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue(null);

    await expect(harness.service.resend('missing-id')).rejects.toBeInstanceOf(
      WebhookOutboxNotFoundException,
    );
  });

  it('skips resend for DELIVERED or SENDING outbox rows', async () => {
    const harness = createHarness();
    const deliveredPayload = createPayload();
    const sendingPayload = createPayload();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'delivered-id',
      status: WebhookOutboxStatus.DELIVERED,
      payload: deliveredPayload,
    });
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValueOnce({
      id: 'sending-id',
      status: WebhookOutboxStatus.SENDING,
      payload: sendingPayload,
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    await expect(harness.service.resend('delivered-id')).resolves.toBeUndefined();
    await expect(harness.service.resend('sending-id')).resolves.toBeUndefined();

    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_resend_requested',
        resourceId: 'delivered-id',
        metadata: { operation: 'resend', payload: deliveredPayload },
      }),
    );
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_resend_noop',
        resourceId: 'delivered-id',
        metadata: { outcome: 'already_delivered', payload: deliveredPayload },
      }),
    );
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_resend_requested',
        resourceId: 'sending-id',
        metadata: { operation: 'resend', payload: sendingPayload },
      }),
    );
    expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'webhook.outbound_resend_noop',
        resourceId: 'sending-id',
        metadata: { outcome: 'already_sending', payload: sendingPayload },
      }),
    );

    expect(harness.webhookRepository.claimPendingForDelivery).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('queues a resend without claiming the outbox row in the API process', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
      attempts: 1,
    };
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: claimedEntry.id,
      status: WebhookOutboxStatus.PENDING,
      onboardingId: claimedEntry.onboardingId,
      eventType: claimedEntry.eventType,
    });
    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(claimedEntry.id);
    expect(harness.webhookRepository.claimPendingForDelivery).not.toHaveBeenCalled();
  });

  it('queues a PENDING row for worker delivery when resending', async () => {
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
    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(claimedEntry.id);
    expect(harness.webhookRepository.claimPendingForDelivery).not.toHaveBeenCalled();
  });

  it('queues a PENDING resend without attempting a claim', async () => {
    const harness = createHarness();
    const payload = createPayload();
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.PENDING,
      payload,
    });
    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(
      '01912345-6789-7abc-8def-0123456789ac',
    );
    expect(harness.webhookRepository.markDeliveredFromSending).not.toHaveBeenCalled();
  });

  it('does not surface worker delivery failures from the resend request', async () => {
    const harness = createHarness();
    const claimedEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      onboardingId: '01912345-6789-7abc-8def-0123456789aa',
      eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
      endpointUrl: 'https://client.example/webhooks/onboarding',
      payload: createPayload(),
      attempts: 1,
    };
    (harness.webhookRepository.findById as jest.Mock).mockResolvedValue({
      id: '01912345-6789-7abc-8def-0123456789ac',
      status: WebhookOutboxStatus.PENDING,
      payload: claimedEntry.payload,
    });
    await expect(
      harness.service.resend('01912345-6789-7abc-8def-0123456789ac'),
    ).resolves.toBeUndefined();
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(claimedEntry.id);
    expect(harness.webhookRepository.finalizeFailedClaimFromSending).not.toHaveBeenCalled();
  });

  describe('process', () => {
    it('delegates validation and mapping to the resolved adapter and returns the mapped callback result', async () => {
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
        callbackAuth: { kind: 'none', justification: 'test fixture' },
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
        providerIdentity: 'mock_async_callback',
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

    it('writes a mapping-failed webhook audit event when the adapter mapping throws', async () => {
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockReturnValue({
          name: 'mock_async_callback',
          type: 'mock_async_callback',
          supportsAsyncCallback: true,
          callbackAuth: { kind: 'none', justification: 'test fixture' },
          execute: jest.fn(),
          mapCallbackResult: jest.fn().mockRejectedValue(new Error('mapping blew up')),
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);

      await expect(
        harness.service.process(manager, {
          providerKey: 'mock_async_callback',
          rawBody: new Uint8Array([1]),
          headers: {},
        }),
      ).rejects.toThrow('mapping blew up');

      expect(harness.auditService.logWebhook).toHaveBeenCalledWith(
        manager,
        expect.objectContaining({
          action: 'webhook.inbound_callback_mapping_failed',
          resourceType: 'provider_callback',
          metadata: { reason: 'mapping_failed' },
        }),
      );
    });

    it('verifies a signed callback before delegating to the adapter mapping', async () => {
      const signingSecret = 'callback-signing-value';
      const rawBody = new TextEncoder().encode('{"providerReference":"ref-1"}');
      const signature = createHmac('sha256', signingSecret).update(rawBody).digest('hex');
      const mapCallbackResult = jest.fn().mockResolvedValue({
        onboardingId: 'onboarding-1',
        submittedData: { acceptedTerms: true },
        resolvedConnector: { connectorOrder: 1 },
        result: ConnectorExecutionResult.accepted(),
      });
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockReturnValue({
          name: 'acme_kyc',
          type: 'acme_kyc',
          supportsAsyncCallback: true,
          callbackAuth: {
            kind: 'hmac',
            algorithm: 'sha256',
            signatureHeader: 'x-acme-signature',
            encoding: 'hex',
          },
          execute: jest.fn(),
          mapCallbackResult,
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(
        5000,
        manager,
        manager,
        connectorExecutionPort,
        createCallbackSignatureVerifier({ acme_kyc: signingSecret }),
      );

      await expect(
        harness.service.process(manager, {
          providerKey: 'acme_kyc',
          rawBody,
          headers: { 'X-Acme-Signature': signature },
        }),
      ).resolves.toMatchObject({ onboardingId: 'onboarding-1' });

      expect(mapCallbackResult).toHaveBeenCalledTimes(1);
    });

    it('rejects an unsigned callback for a signed connector before any mapping', async () => {
      const mapCallbackResult = jest.fn();
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockReturnValue({
          name: 'acme_kyc',
          type: 'acme_kyc',
          supportsAsyncCallback: true,
          callbackAuth: {
            kind: 'hmac',
            algorithm: 'sha256',
            signatureHeader: 'x-acme-signature',
            encoding: 'hex',
          },
          execute: jest.fn(),
          mapCallbackResult,
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(
        5000,
        manager,
        manager,
        connectorExecutionPort,
        createCallbackSignatureVerifier({ acme_kyc: 'callback-signing-value' }),
      );

      await expect(
        harness.service.process(manager, {
          providerKey: 'acme_kyc',
          rawBody: new Uint8Array([1, 2, 3]),
          headers: {},
        }),
      ).rejects.toBeInstanceOf(CallbackSignatureInvalidException);

      expect(mapCallbackResult).not.toHaveBeenCalled();
      expect(harness.auditService.logWebhook).not.toHaveBeenCalled();
    });

    it('fails closed when a callback-capable adapter declares no callback auth', async () => {
      const mapCallbackResult = jest.fn();
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockReturnValue({
          name: 'acme_kyc',
          type: 'acme_kyc',
          supportsAsyncCallback: true,
          execute: jest.fn(),
          mapCallbackResult,
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);

      await expect(
        harness.service.process(manager, {
          providerKey: 'acme_kyc',
          rawBody: new Uint8Array([1, 2, 3]),
          headers: {},
        }),
      ).rejects.toMatchObject({ reason: 'callback_auth_not_declared' });

      expect(mapCallbackResult).not.toHaveBeenCalled();
    });

    it('preserves the original mapping error when mapping-failed audit persistence fails', async () => {
      const connectorExecutionPort = {
        execute: jest.fn(),
        resume: jest.fn(),
        findAdapterByType: jest.fn().mockReturnValue({
          name: 'mock_async_callback',
          type: 'mock_async_callback',
          supportsAsyncCallback: true,
          callbackAuth: { kind: 'none', justification: 'test fixture' },
          execute: jest.fn(),
          mapCallbackResult: jest.fn().mockRejectedValue(new Error('mapping blew up')),
        }),
      } as unknown as jest.Mocked<ConnectorExecutionPort>;
      const harness = createHarness(5000, manager, manager, connectorExecutionPort);
      (harness.auditService.logWebhook as jest.Mock).mockRejectedValueOnce(
        new Error('audit failed'),
      );

      await expect(
        harness.service.process(manager, {
          providerKey: 'mock_async_callback',
          rawBody: new Uint8Array([1]),
          headers: {},
        }),
      ).rejects.toThrow('mapping blew up');
    });
  });
});
