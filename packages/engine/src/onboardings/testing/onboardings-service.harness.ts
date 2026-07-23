import { DataSource, EntityManager } from 'typeorm';
import { ClientWebhookNotifyService } from '../../client-webhook-outbox/client-webhook-notify.service';
import { ClientWebhookUrlResolver } from '../../config/client-webhook-url-resolver';
import { Workflow, WorkflowEvaluationResult } from '../../workflows/domain/workflow';
import { WorkflowRegistryService } from '../../workflows/workflow-registry.service';
import { OnboardingEntity } from '../entity/onboarding.entity';
import { OnboardingWebhookService } from '../onboarding-webhook/onboarding-webhook.service';
import { OnboardingsRepository } from '../onboardings.repository';
import { OnboardingsService } from '../onboardings.service';

export const manager = {} as EntityManager;

export const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
  Object.assign(new OnboardingEntity(), {
    id: '01912345-6789-7abc-8def-0123456789ab',
    workflowId: 'passport-check',
    workflowVersion: 3,
    status: 'awaiting_user',
    currentStep: 'capture_alias',
    context: {},
    expiresAt: null,
    completedAt: null,
    ...overrides,
  });

export interface HarnessOptions {
  onboarding?: OnboardingEntity;
  workflowOverrides?: Partial<Workflow>;
  workflowRegistryOverrides?: Partial<WorkflowRegistryService>;
  outboxIdPrefix?: string;
  resolvedWebhookUrl?: string;
}

export const createHarness = (options: HarnessOptions = {}) => {
  const {
    onboarding,
    workflowOverrides = {},
    workflowRegistryOverrides = {},
    outboxIdPrefix = 'outbox-',
    resolvedWebhookUrl = 'https://client.example/webhooks/onboarding/',
  } = options;

  const transactionOrder: string[] = [];
  const transaction = jest.fn(async (callback: (tx: EntityManager) => unknown) => {
    transactionOrder.push('transaction:start');
    const result = await callback(manager);
    transactionOrder.push('transaction:resolved');
    return result;
  });
  const dataSource = { transaction, manager } as unknown as DataSource;
  const repository = {
    createInitial: jest.fn(),
    findByIdForUpdate: jest.fn().mockResolvedValue(onboarding ?? null),
    saveLocked: jest.fn().mockImplementation(async (_tx, entity) => entity),
    findForAdmin: jest.fn().mockResolvedValue([]),
  } as unknown as OnboardingsRepository;
  const workflow: Workflow = {
    initialize: jest.fn().mockReturnValue({
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
    }),
    evaluate: jest.fn().mockResolvedValue({
      acceptedData: { contactAddress: 'person@example.com' },
      appliedStep: 'capture_alias',
      sourceStepWebhook: {
        eventType: 'onboarding.state_changed',
        path: 'state-changed',
      },
      nextState: {
        context: { contactAddress: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
      },
    } satisfies WorkflowEvaluationResult),
    getSourceStepWebhook: jest.fn().mockReturnValue({
      eventType: 'onboarding.state_changed',
      path: 'state-changed',
    }),
    ...workflowOverrides,
  } as unknown as Workflow;
  const workflowRegistryService: WorkflowRegistryService = {
    getById: jest.fn().mockReturnValue(workflow),
    ...workflowRegistryOverrides,
  } as unknown as WorkflowRegistryService;
  const onboardingWebhookService = {
    createPendingEvent: jest.fn().mockImplementation(async (_tx, _url, eventType) => {
      if (!outboxIdPrefix) {
        return null;
      }

      return `${outboxIdPrefix}${eventType}`;
    }),
  } as unknown as OnboardingWebhookService;
  const clientWebhookNotifyService = {
    notify: jest.fn().mockImplementation(async () => {
      transactionOrder.push('notify:called');
    }),
  } as unknown as ClientWebhookNotifyService;
  const clientWebhookUrlResolver = {
    resolve: jest.fn().mockImplementation((path: string) => `${resolvedWebhookUrl}${path}`),
  } as unknown as ClientWebhookUrlResolver;

  return {
    service: new OnboardingsService(
      dataSource,
      repository,
      workflowRegistryService,
      onboardingWebhookService,
      clientWebhookNotifyService,
      clientWebhookUrlResolver,
    ),
    transaction,
    transactionOrder,
    repository,
    workflow,
    workflowRegistryService,
    onboardingWebhookService,
    clientWebhookNotifyService,
    clientWebhookUrlResolver,
  };
};
