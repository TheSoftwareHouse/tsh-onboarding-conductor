import { DataSource, EntityManager } from 'typeorm';
import { Workflow, WorkflowEvaluationResult } from '../../workflows/domain/workflow';
import { WorkflowRegistryService } from '../../workflows/workflow-registry.service';
import { WebhookService } from '../../webhook/webhook.service';
import { OnboardingEntity } from '../entity/onboarding.entity';
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
}

export const createHarness = (options: HarnessOptions = {}) => {
  const { onboarding, workflowOverrides = {}, workflowRegistryOverrides = {} } = options;

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
    evaluate: jest.fn().mockResolvedValue(
      WorkflowEvaluationResult.accepted({ contactAddress: 'person@example.com' }, 'capture_alias', {
        context: { contactAddress: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
        rejectionReason: null,
      }),
    ),
    evaluateManual: jest.fn().mockResolvedValue(
      WorkflowEvaluationResult.accepted({}, 'manual_review', {
        context: {},
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
        rejectionReason: null,
      }),
    ),
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
    notify: jest.fn().mockImplementation(async (_manager, workflow, eventType, onboarding) => {
      void _manager;
      void eventType;

      const sourceStepWebhook = workflow.getSourceStepWebhook(onboarding.currentStep);
      if (sourceStepWebhook === undefined) {
        return;
      }

      transactionOrder.push('notify:called');
    }),
  } as unknown as WebhookService;

  return {
    service: new OnboardingsService(
      dataSource,
      repository,
      workflowRegistryService,
      onboardingWebhookService,
    ),
    transaction,
    transactionOrder,
    repository,
    workflow,
    workflowRegistryService,
    onboardingWebhookService,
  };
};
