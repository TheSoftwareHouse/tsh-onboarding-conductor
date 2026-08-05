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
import { WebhookEventPayload, WebhookEventType } from './webhook-event';
import { WebhookQueueService } from './webhook-queue.service';
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
    } as unknown as WebhookRepository;
    const clientWebhookUrlResolver = {
      resolve: jest.fn(),
    } as unknown as ClientWebhookUrlResolver;
    const webhookQueueService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    } as unknown as WebhookQueueService;
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
        webhookQueueService,
        connectorExecutionPort,
      ),
      dataSource,
      webhookRepository,
      clientWebhookUrlResolver,
      webhookQueueService,
      configService,
      transactionManager,
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

    expect(harness.dataSource.transaction).not.toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      dataSourceManager,
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
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(outboxEntry.id);
  });

  it('creates a PENDING notification intent and enqueues it without dispatching HTTP', async () => {
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
    expect(
      (harness.service as unknown as { dataSource: { transaction: jest.Mock } }).dataSource
        .transaction,
    ).not.toHaveBeenCalled();
    expect(harness.webhookRepository.createPending).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      }),
    );
    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(outboxEntry.id);
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('contains queue wake-up failures in notify with a bounded warning log', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookQueueService.enqueue as jest.Mock).mockRejectedValue(new Error('queue failed'));

    await expect(harness.service.notify(onboarding, createWorkflow())).resolves.toBeUndefined();
    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${outboxEntry.id} reason=queue failed`,
    );
  });

  it('contains queue wake-up failures in notifyError with a bounded warning log', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ rootPath: 'state-changed' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    const loggerSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    onboarding.capturePreMutationWebhookSnapshot();

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookQueueService.enqueue as jest.Mock).mockRejectedValue(new Error('queue failed'));

    await expect(
      harness.service.notifyError(new Error('lifecycle failed'), onboarding, workflow),
    ).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_OUTBOX_ENQUEUE_FAILED outboxId=${outboxEntry.id} reason=queue failed`,
    );
  });

  it('contains unexpected enqueueOutbox failures in notify and logs a bounded metadata error', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    const loggerSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const enqueueOutboxError = new Error('enqueueOutbox exploded');

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    jest
      .spyOn(
        harness.service as unknown as {
          enqueueOutbox: (onboarding: unknown, notifyWebhook: unknown) => Promise<void>;
        },
        'enqueueOutbox',
      )
      .mockRejectedValueOnce(enqueueOutboxError);

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(loggerSpy).toHaveBeenCalledWith(
      `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id} reason=enqueueOutbox exploded`,
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
    expect(harness.webhookQueueService.enqueue).not.toHaveBeenCalled();
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
      `CLIENT_WEBHOOK_NOTIFY_FAILED onboardingId=${onboarding.id} reason=CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured`,
    );
  });

  it('keeps queue wake-up internal to notify without dispatching HTTP', async () => {
    const harness = createHarness();
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const workflow = createWorkflow({ effectivePath: 'state-changed' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    const fetchSpy = jest.spyOn(globalThis, 'fetch');

    onboarding.setLifecycleTakenTransition({ status: 'success', target: 'approved' });

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createPending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookQueueService.enqueue as jest.Mock).mockResolvedValue(undefined);

    await expect(harness.service.notify(onboarding, workflow)).resolves.toBeUndefined();

    expect(harness.webhookQueueService.enqueue).toHaveBeenCalledWith(outboxEntry.id);
    expect(fetchSpy).not.toHaveBeenCalled();
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
