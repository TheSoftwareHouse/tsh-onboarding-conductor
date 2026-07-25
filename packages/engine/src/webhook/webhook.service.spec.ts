import { ConfigService } from '@nestjs/config';
import type { WorkflowStatus } from '@tsh/ddl-schema';
import { DataSource, EntityManager } from 'typeorm';
import { AppConfig } from '../config/app.config';
import { ClientWebhookUrlResolver } from '../config/client-webhook-url-resolver';
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

  const createWorkflow = (
    webhook: { path: string } | undefined = { path: 'state-changed' },
    lookupStep: string | null = null,
  ) =>
    ({
      getSourceStepWebhook: jest.fn().mockImplementation((step: string | null | undefined) => {
        if (lookupStep !== null && step !== lookupStep) {
          return undefined;
        }

        return webhook;
      }),
    }) as unknown as Workflow;

  const createHarness = (
    timeoutMs = 5000,
    transactionManager: EntityManager = manager,
    dataSourceManager: EntityManager = manager,
  ) => {
    const dataSource = { manager: dataSourceManager } as DataSource;
    const webhookRepository = {
      createSending: jest.fn(),
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
      ),
      webhookRepository,
      clientWebhookUrlResolver,
      configService,
      transactionManager,
    };
  };

  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('no-ops for an undefined declaration without resolving or creating an outbox row', async () => {
    const harness = createHarness();
    const workflow = {
      getSourceStepWebhook: jest.fn().mockReturnValue(undefined),
    } as unknown as Workflow;

    await expect(
      harness.service.notify(
        manager,
        workflow,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        createOnboarding(),
      ),
    ).resolves.toBeUndefined();

    expect(harness.clientWebhookUrlResolver.resolve).not.toHaveBeenCalled();
    expect(harness.webhookRepository.createSending).not.toHaveBeenCalled();
    expect(workflow.getSourceStepWebhook).toHaveBeenCalledWith('capture_alias');
  });

  it('uses the active onboarding step for lookup when dispatching a notification', async () => {
    const harness = createHarness();
    const workflow = {
      getSourceStepWebhook: jest.fn().mockImplementation((step: string | null | undefined) => {
        if (step === 'confirm_identity') {
          return { path: 'state-changed' };
        }

        return undefined;
      }),
    } as unknown as Workflow;
    const onboarding = createOnboarding({ currentStep: 'confirm_identity' });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createSending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await harness.service.notify(
      manager,
      workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      onboarding,
    );

    expect(workflow.getSourceStepWebhook).toHaveBeenCalledWith('confirm_identity');
  });

  it('creates SENDING and delivers immediately through the supplied manager using persisted payload data', async () => {
    const transactionManager = {} as EntityManager;
    const dataSourceManager = {} as EntityManager;
    const harness = createHarness(2500, transactionManager, dataSourceManager);
    const workflow = createWorkflow({ path: 'state-changed' });
    const onboarding = createOnboarding({
      status: 'approved' as WorkflowStatus,
      currentStep: null,
      completedAt: new Date('2026-07-20T10:00:00.000Z'),
    });
    const outboxEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };

    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createSending as jest.Mock).mockResolvedValue(outboxEntry);
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);

    let resolveFetch!: (response: Response) => void;
    const fetchPromise = new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(() => fetchPromise);

    const notifyPromise = harness.service.notify(
      transactionManager,
      workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      onboarding,
    );

    await Promise.resolve();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    resolveFetch({ ok: true } as Response);
    await expect(notifyPromise).resolves.toBeUndefined();

    expect(workflow.getSourceStepWebhook).toHaveBeenCalledWith(onboarding.currentStep);
    expect(harness.clientWebhookUrlResolver.resolve).toHaveBeenCalledWith('state-changed');
    expect(harness.webhookRepository.createSending).toHaveBeenCalledWith(
      transactionManager,
      expect.objectContaining({
        onboardingId: onboarding.id,
        eventType: WebhookEventType.ONBOARDING_STATE_CHANGED,
        endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
        payload: {
          version: 1,
          event: {
            id: expect.any(String),
            type: WebhookEventType.ONBOARDING_STATE_CHANGED,
            occurredAt: expect.any(String),
          },
          onboarding: {
            id: onboarding.id,
            workflowId: onboarding.workflowId,
            workflowVersion: onboarding.workflowVersion,
            status: 'approved',
            currentStep: null,
            completedAt: '2026-07-20T10:00:00.000Z',
          },
        },
      }),
    );
    expect(harness.webhookRepository.markDeliveredFromSending).toHaveBeenCalledWith(
      transactionManager,
      outboxEntry.id,
      expect.any(Date),
    );
  });

  it('marks it delivered on 2xx using the supplied manager', async () => {
    const transactionManager = {} as EntityManager;
    const harness = createHarness(2500, transactionManager, manager);
    const workflow = createWorkflow({ path: 'state-changed' });
    const createdEntry = {
      id: '01912345-6789-7abc-8def-0123456789ac',
      endpointUrl: 'https://client.example/webhooks/onboarding/state-changed',
      payload: createPayload(),
    };
    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createSending as jest.Mock).mockResolvedValue(createdEntry);
    (harness.webhookRepository.markDeliveredFromSending as jest.Mock).mockResolvedValue(true);
    const timeoutSignal = new AbortController().signal;
    const abortTimeoutSpy = jest.spyOn(AbortSignal, 'timeout').mockReturnValue(timeoutSignal);
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);

    await harness.service.notify(
      transactionManager,
      workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      createOnboarding(),
    );

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
      transactionManager,
      createdEntry.id,
      expect.any(Date),
    );
  });

  it('restores a sending event to PENDING and swallows expected delivery failures after restoration', async () => {
    const transactionManager = {} as EntityManager;
    const harness = createHarness(5000, transactionManager, manager);
    const workflow = createWorkflow({ path: 'state-changed' });
    const createdEntry = { id: '01912345-6789-7abc-8def-0123456789ac' };
    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createSending as jest.Mock).mockResolvedValue(createdEntry);
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(true);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(
      harness.service.notify(
        transactionManager,
        workflow,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        createOnboarding(),
      ),
    ).resolves.toBeUndefined();

    expect(harness.webhookRepository.markPendingFromSending).toHaveBeenCalledWith(
      transactionManager,
      createdEntry.id,
    );
  });

  it('surfaces transition persistence failures after a delivery failure', async () => {
    const transactionManager = {} as EntityManager;
    const harness = createHarness(5000, transactionManager, manager);
    const workflow = createWorkflow({ path: 'state-changed' });
    const createdEntry = { id: '01912345-6789-7abc-8def-0123456789ac' };
    (harness.clientWebhookUrlResolver.resolve as jest.Mock).mockReturnValue(
      'https://client.example/webhooks/onboarding/state-changed',
    );
    (harness.webhookRepository.createSending as jest.Mock).mockResolvedValue(createdEntry);
    (harness.webhookRepository.markPendingFromSending as jest.Mock).mockResolvedValue(false);
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);

    await expect(
      harness.service.notify(
        transactionManager,
        workflow,
        WebhookEventType.ONBOARDING_STATE_CHANGED,
        createOnboarding(),
      ),
    ).rejects.toThrow('CLIENT_WEBHOOK_OUTBOX_PENDING_RESTORE_FAILED');
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
});
