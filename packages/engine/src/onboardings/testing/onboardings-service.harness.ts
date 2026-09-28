import { DataSource, EntityManager } from 'typeorm';
import { AgreementsService } from '../../agreements/agreements.service';
import { AgreementEntity } from '../../agreements/entity/agreement.entity';
import { AgreementVersionEntity } from '../../agreements/entity/agreement-version.entity';
import { AuditService } from '../../audit/audit.service';
import {
  DEFAULT_PAGINATION_LIMIT,
  DEFAULT_PAGINATION_PAGE,
  countTotalPages,
  type PaginatedResult,
} from '../../pagination';
import { ListAdminOnboardingsQueryDto } from '../dto/list-admin-onboardings.query.dto';
import { Workflow, WorkflowEvaluationResult } from '../../workflows/domain/workflow';
import { WorkflowEntity } from '../../workflows/entity/workflow.entity';
import { WorkflowVersionEntity } from '../../workflows/entity/workflow-version.entity';
import { WorkflowRegistryService } from '../../workflows/workflow-registry.service';
import { WebhookService } from '../../webhook/webhook.service';
import { OnboardingAgreementEntity } from '../entity/onboarding-agreement.entity';
import { OnboardingEntity } from '../entity/onboarding.entity';
import {
  OnboardingAgreementsRepository,
  type OnboardingAgreementSummary,
} from '../onboarding-agreements.repository';
import { OnboardingsRepository } from '../onboardings.repository';
import { OnboardingsService } from '../onboardings.service';

export const manager = {} as EntityManager;

export const DEFAULT_WORKFLOW_VERSION_ID = '01912345-6789-7abc-8def-00000000f001';
const DEFAULT_WORKFLOW_ID = '01912345-6789-7abc-8def-00000000f000';

/** The `workflowVersion` relation `createOnboarding` loads, as a joined read would. */
const createWorkflowVersion = (
  overrides: Partial<WorkflowVersionEntity> = {},
): WorkflowVersionEntity =>
  Object.assign(new WorkflowVersionEntity(), {
    workflowVersionId: DEFAULT_WORKFLOW_VERSION_ID,
    version: 3,
    workflow: Object.assign(new WorkflowEntity(), {
      workflowId: DEFAULT_WORKFLOW_ID,
      key: 'passport-check',
    }),
    ...overrides,
  });

export const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
  Object.assign(new OnboardingEntity(), {
    id: '01912345-6789-7abc-8def-0123456789ab',
    workflowVersionId: DEFAULT_WORKFLOW_VERSION_ID,
    workflowVersion: createWorkflowVersion(),
    status: 'awaiting_user',
    currentStep: 'capture_alias',
    context: {},
    expiresAt: null,
    completedAt: null,
    scores: {},
    ...overrides,
  });

/**
 * One published agreement version, as the agreements service resolves it for a family, its
 * `agreement` relation loaded. `id` names the version's own id — what the response DTOs call
 * `agreementId` — kept as the shorthand every call site already uses.
 */
export const createAgreement = (
  overrides: {
    id?: string;
    key?: string;
    type?: AgreementEntity['type'];
    version?: number;
    publishedAt?: Date;
    createdAt?: Date;
  } = {},
): AgreementVersionEntity => {
  const {
    id = '01912345-6789-7abc-8def-00000000a001',
    key = 'eu-b2c-terms',
    type = 'terms_and_conditions',
    version = 1,
    publishedAt = new Date('2026-01-01T00:00:00.000Z'),
    createdAt = new Date('2026-01-01T00:00:00.000Z'),
  } = overrides;
  const agreementId = '01912345-6789-7abc-8def-00000000a000';

  return Object.assign(new AgreementVersionEntity(), {
    agreementVersionId: id,
    agreementId,
    version,
    publishedAt,
    createdAt,
    agreement: Object.assign(new AgreementEntity(), { id: agreementId, key, type }),
  });
};

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

/** One family an onboarding holds, as `findSummaries` reports it: accepted against latest. */
export const createAgreementSummary = (
  overrides: Partial<OnboardingAgreementSummary> = {},
): OnboardingAgreementSummary => ({
  key: 'eu-b2c-terms',
  type: 'terms_and_conditions',
  latestAgreementId: '01912345-6789-7abc-8def-00000000a001',
  latestVersion: 1,
  acceptedVersion: null,
  acceptedAt: null,
  ...overrides,
});

export interface HarnessOptions {
  onboarding?: OnboardingEntity;
  workflowOverrides?: Partial<Workflow>;
  workflowRegistryOverrides?: Partial<WorkflowRegistryService>;
  /** Published versions `findLatestForKeys` reports, keyed by family. Empty unless a test says so. */
  latestAgreements?: readonly AgreementVersionEntity[];
  /** Published version `getById` resolves for an explicit `agreementId`. */
  agreement?: AgreementVersionEntity;
  /** Families `findSummaries` reports for the onboarding. Empty unless a test says so. */
  agreementSummaries?: readonly OnboardingAgreementSummary[];
}

export const createHarness = (options: HarnessOptions = {}) => {
  const {
    onboarding,
    workflowOverrides = {},
    workflowRegistryOverrides = {},
    latestAgreements = [],
    agreement,
    agreementSummaries = [],
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
    findById: jest.fn().mockResolvedValue(onboarding ?? null),
    lockAndRefreshPreflight: jest.fn().mockImplementation(async () => undefined),
    saveLocked: jest.fn().mockImplementation(async (_tx, entity) => entity),
    findForAdmin: jest.fn().mockResolvedValue(createAdminOnboardingsPage()),
  } as unknown as OnboardingsRepository;
  const workflow: Workflow = {
    id: 'passport-check',
    version: 3,
    initialize: jest.fn().mockReturnValue({
      workflowId: 'passport-check',
      workflowVersion: 3,
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      scores: {},
    }),
    getRootNotifyWebhook: jest.fn().mockReturnValue({ path: 'state-changed' }),
    getDeclaredAgreementKeys: jest.fn().mockReturnValue([]),
    findStepAgreements: jest.fn().mockReturnValue([]),
    findStep: jest.fn().mockReturnValue(undefined),
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
    resolveForStart: jest
      .fn()
      .mockResolvedValue({ workflow, versionId: DEFAULT_WORKFLOW_VERSION_ID }),
    getByVersionId: jest.fn().mockResolvedValue(workflow),
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
    notifyAgreementPending: jest.fn().mockImplementation(async () => {
      transactionOrder.push('notifyAgreementPending:called');
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
    logAgreement: jest.fn().mockImplementation(async () => {
      transactionOrder.push('audit:agreement');
    }),
  } as unknown as AuditService;

  const agreementsService = {
    findLatestForKeys: jest
      .fn()
      .mockResolvedValue(
        new Map(latestAgreements.map((published) => [published.agreement.key, published])),
      ),
    getById: jest.fn().mockResolvedValue(agreement ?? createAgreement()),
    linkPending: jest.fn().mockImplementation(async () => {
      transactionOrder.push('agreement:link');
      return true;
    }),
  } as unknown as AgreementsService;

  const onboardingAgreementsRepository = {
    findLink: jest.fn().mockImplementation(async (_tx, published, onboardingId) =>
      Object.assign(new OnboardingAgreementEntity(), {
        onboardingId,
        agreementVersionId: published.agreementVersionId,
        status: 'pending',
        acceptedAt: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ),
    acceptLink: jest.fn().mockImplementation(async (_tx, published, onboardingId, acceptedAt) => {
      transactionOrder.push('agreement:accept');

      return Object.assign(new OnboardingAgreementEntity(), {
        onboardingId,
        agreementVersionId: published.agreementVersionId,
        status: 'accepted',
        acceptedAt,
        createdAt: acceptedAt,
      });
    }),
    findSummaries: jest.fn().mockImplementation(async () => {
      transactionOrder.push('agreement:summaries');

      return [...agreementSummaries];
    }),
  } as unknown as OnboardingAgreementsRepository;

  return {
    service: new OnboardingsService(
      dataSource,
      repository,
      workflowRegistryService,
      onboardingWebhookService,
      auditService,
      agreementsService,
      onboardingAgreementsRepository,
    ),
    dataSource,
    transaction,
    transactionOrder,
    repository,
    workflow,
    workflowRegistryService,
    onboardingWebhookService,
    auditService,
    agreementsService,
    onboardingAgreementsRepository,
  };
};
