import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_PAGE,
  countTotalPages,
  type PaginatedResult,
} from '../../pagination';
import { ListAdminOnboardingsQueryDto } from '../dto/list-admin-onboardings.query.dto';
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
    scores: {},
    ...overrides,
  });

/**
 * One page of onboarding rows as `findForAdmin` now reports them. Defaults describe a single
 * unfiltered first page, so a test only states the window when the window is what it is about.
 */
export const createAdminOnboardingsPage = (
  items: OnboardingEntity[] = [],
  overrides: Partial<PaginatedResult<OnboardingEntity>> = {},
): PaginatedResult<OnboardingEntity> => ({
  items,
  total: items.length,
  page: DEFAULT_PAGINATION_PAGE,
  limit: DEFAULT_PAGINATION_LIMIT,
  totalPages: countTotalPages(items.length, DEFAULT_PAGINATION_LIMIT),
  ...overrides,
});

/**
 * Builds the query the controller's validation pipe would hand the service: the named filters
 * over the inherited `page`/`limit` defaults.
 */
export const createListAdminOnboardingsQuery = (
  overrides: Partial<ListAdminOnboardingsQueryDto> = {},
): ListAdminOnboardingsQueryDto => Object.assign(new ListAdminOnboardingsQueryDto(), overrides);

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
    findById: jest.fn().mockResolvedValue(onboarding ?? null),
    lockAndRefreshPreflight: jest.fn().mockImplementation(async () => undefined),
    saveLocked: jest.fn().mockImplementation(async (_tx, entity) => entity),
    findForAdmin: jest.fn().mockResolvedValue(createAdminOnboardingsPage()),
  } as unknown as OnboardingsRepository;
  const workflow: Workflow = {
    initialize: jest.fn().mockReturnValue({
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      scores: {},
    }),
    getRootNotifyWebhook: jest.fn().mockReturnValue({ path: 'state-changed' }),
    evaluate: jest.fn().mockResolvedValue(
      WorkflowEvaluationResult.accepted(
        { contactAddress: 'person@example.com' },
        'capture_alias',
        {
          context: { contactAddress: 'person@example.com' },
          status: 'awaiting_user',
          currentStep: 'confirm_identity',
          completedAt: null,
          rejectionReason: null,
          scores: {},
        },
        { status: 'success', target: 'confirm_identity' },
      ),
    ),
    evaluateManual: jest.fn().mockResolvedValue(
      WorkflowEvaluationResult.accepted(
        {},
        'manual_review',
        {
          context: {},
          status: 'awaiting_user',
          currentStep: 'confirm_identity',
          completedAt: null,
          rejectionReason: null,
          scores: {},
        },
        { status: 'manual.approve', target: 'approved' },
      ),
    ),
    ...workflowOverrides,
  } as unknown as Workflow;
  const workflowRegistryService: WorkflowRegistryService = {
    getById: jest.fn().mockReturnValue(workflow),
    ...workflowRegistryOverrides,
  } as unknown as WorkflowRegistryService;
  const onboardingWebhookService = {
    notify: jest.fn().mockImplementation(async () => {
      transactionOrder.push('notify:called');
      return undefined;
    }),
    notifyError: jest.fn().mockImplementation(async () => {
      transactionOrder.push('notifyError:called');
    }),
  } as unknown as WebhookService;

  const auditService = {
    log: jest.fn().mockImplementation(async () => {
      transactionOrder.push('audit:write');
    }),
    logRejectedAttempt: jest.fn(),
    logWebhook: jest.fn().mockResolvedValue(undefined),
    logApiFailure: jest.fn().mockResolvedValue(undefined),
    logConnectorOutcome: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  return {
    service: new OnboardingsService(
      dataSource,
      repository,
      workflowRegistryService,
      onboardingWebhookService,
      auditService,
    ),
    dataSource,
    transaction,
    transactionOrder,
    repository,
    workflow,
    workflowRegistryService,
    onboardingWebhookService,
    auditService,
  };
};
