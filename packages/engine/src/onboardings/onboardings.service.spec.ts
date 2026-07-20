import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Workflow, WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';

describe('OnboardingsService', () => {
  const manager = {} as EntityManager;

  const createOnboarding = (overrides: Partial<OnboardingEntity> = {}): OnboardingEntity =>
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

  const createHarness = (
    onboarding?: OnboardingEntity,
    workflowOverrides: Partial<Workflow> = {},
    workflowRegistryOverrides: Partial<WorkflowRegistryService> = {},
  ) => {
    const transaction = jest.fn(async (callback: (tx: EntityManager) => unknown) =>
      callback(manager),
    );
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
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        terminal: false,
      } satisfies WorkflowEvaluationResult),
      ...workflowOverrides,
    } as unknown as Workflow;
    const workflowRegistryService: WorkflowRegistryService = {
      getById: jest.fn().mockReturnValue(workflow),
      ...workflowRegistryOverrides,
    } as unknown as WorkflowRegistryService;

    return {
      service: new OnboardingsService(dataSource, repository, workflowRegistryService),
      transaction,
      repository,
      workflow,
      workflowRegistryService,
    };
  };

  it('lists all admin summaries without filters', async () => {
    const harness = createHarness();
    const query = {};
    const repoResult = [createOnboarding({ id: 'onboarding-1' })];
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue(repoResult);

    const response = await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
    expect(response).toEqual([
      {
        onboardingId: repoResult[0].id,
        workflowId: repoResult[0].workflowId,
        workflowVersion: repoResult[0].workflowVersion,
        status: repoResult[0].status,
        currentStep: repoResult[0].currentStep,
        expiresAt: repoResult[0].expiresAt,
        createdAt: repoResult[0].createdAt,
        updatedAt: repoResult[0].updatedAt,
        completedAt: repoResult[0].completedAt,
      },
    ]);
  });

  it('passes the status filter through to the repository', async () => {
    const harness = createHarness();
    const query = { status: 'approved' as const };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the workflowId filter through to the repository', async () => {
    const harness = createHarness();
    const query = { workflowId: 'passport-check' };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes both filters through to the repository', async () => {
    const harness = createHarness();
    const query = { status: 'approved' as const, workflowId: 'passport-check' };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the workflowVersion filter through to the repository', async () => {
    const harness = createHarness();
    const query = { workflowVersion: 7 };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the currentStep filter through to the repository', async () => {
    const harness = createHarness();
    const query = { currentStep: 'confirm_identity' };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the onboardingId filter through to the repository', async () => {
    const harness = createHarness();
    const query = { onboardingId: '01912345-6789-7abc-8def-0123456789ab' };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    expect(harness.repository.findForAdmin).toHaveBeenCalledWith(manager, query);
  });

  it('passes the validated mixed filters to the repository unchanged', async () => {
    const harness = createHarness();
    const query = {
      status: 'approved' as const,
      workflowId: 'passport-check',
      workflowVersion: 3,
      currentStep: 'confirm_identity',
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
    };
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await harness.service.listForAdmin(query);

    const [managerArg, filtersArg] = (harness.repository.findForAdmin as jest.Mock).mock.calls[0];
    expect(managerArg).toBe(manager);
    expect(filtersArg).toBe(query);
  });

  it('returns an empty array when the repository returns no rows', async () => {
    const harness = createHarness();
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([]);

    await expect(harness.service.listForAdmin({})).resolves.toEqual([]);
  });

  it('maps lifecycle summaries and omits context even when the entity contains data', async () => {
    const harness = createHarness();
    const entity = createOnboarding({
      id: 'onboarding-2',
      context: { secret: 'payload' },
      createdAt: new Date('2026-07-16T12:00:00.000Z'),
      updatedAt: new Date('2026-07-16T12:30:00.000Z'),
      completedAt: new Date('2026-07-17T00:00:00.000Z'),
    });
    (harness.repository.findForAdmin as jest.Mock).mockResolvedValue([entity]);

    const response = await harness.service.listForAdmin({});

    expect(response).toEqual([
      {
        onboardingId: entity.id,
        workflowId: entity.workflowId,
        workflowVersion: entity.workflowVersion,
        status: entity.status,
        currentStep: entity.currentStep,
        expiresAt: entity.expiresAt,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
        completedAt: entity.completedAt,
      },
    ]);
    expect(response[0]).not.toHaveProperty('context');
    expect(response[0]).not.toHaveProperty('id');
  });

  it('creates the initial row in a transaction and returns the initial state', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const response = await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('unused-name', 1);
    expect(harness.workflow.initialize).toHaveBeenCalledWith();
    expect(harness.repository.createInitial).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        id: response.onboardingId,
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        context: {},
        expiresAt: null,
        completedAt: null,
      }),
    );
    expect(response).toEqual({
      onboardingId: expect.any(String),
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      expiresAt: null,
    });
  });

  it('returns distinct ids for separate accepted starts', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const first = await harness.service.start({ workflowId: 'first' });
    const second = await harness.service.start({ workflowId: 'second' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
    expect(harness.repository.createInitial).toHaveBeenCalledTimes(2);
  });

  it('does not generate an id or persist when workflow initialization fails', async () => {
    const harness = createHarness(
      undefined,
      {},
      {
        getById: jest.fn().mockImplementation(() => {
          throw new WorkflowNotFoundException();
        }),
      },
    );

    await expect(harness.service.start({ workflowId: 'missing' })).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      },
      status: 404,
    });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.repository.createInitial).not.toHaveBeenCalled();
  });

  it('returns the stable not-found error for an unknown onboarding', async () => {
    const harness = createHarness();

    await expect(harness.service.submit('missing', {})).rejects.toBeInstanceOf(NotFoundException);
    await expect(harness.service.submit('missing', {})).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_NOT_FOUND',
        message: 'ONBOARDING_NOT_FOUND',
      },
    });
    expect(harness.repository.findByIdForUpdate).toHaveBeenCalledWith(manager, 'missing');
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.workflowRegistryService.getById).not.toHaveBeenCalled();
  });

  it('delegates locked lookup and runtime evaluation, then persists accepted data', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding);

    const first = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });
    expect(first).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
    });
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('passport-check', 3);
    expect(harness.workflow.evaluate).toHaveBeenCalledWith({
      currentStep: 'capture_alias',
      submittedData: { contactAddress: 'person@example.com' },
    });
    expect(harness.repository.findByIdForUpdate).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });

    (harness.workflow.evaluate as jest.Mock).mockResolvedValueOnce({
      acceptedData: { identityConfirmed: true },
      appliedStep: 'confirm_identity',
      status: 'approved',
      currentStep: null,
      terminal: true,
    } satisfies WorkflowEvaluationResult);
    const second = await harness.service.submit('onboarding-id', {
      identityConfirmed: true,
    });
    expect(second).toEqual({
      appliedStep: 'confirm_identity',
      status: 'approved',
      currentStep: null,
    });
    expect(onboarding.context).toEqual({
      contactAddress: 'person@example.com',
      identityConfirmed: true,
    });
    expect(onboarding.completedAt).toBeInstanceOf(Date);
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(2);
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid runtime results without saving or mutating the entity', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const harness = createHarness(onboarding, {
      evaluate: jest.fn().mockResolvedValue(undefined),
    });
    const before = { ...onboarding, context: { ...onboarding.context } };

    const error = await harness.service
      .submit('onboarding-id', { contactAddress: 'invalid' })
      .catch((caught: unknown) => caught as unknown);

    expect(error).toBeInstanceOf(BadRequestException);
    if (!(error instanceof BadRequestException)) {
      throw new Error('Expected a BadRequestException');
    }

    expect(error.getResponse()).toEqual({
      code: 'INVALID_STEP_DATA',
      message: 'INVALID_STEP_DATA',
    });
    expect(error.getResponse()).not.toHaveProperty('details');

    expect(harness.workflow.evaluate).toHaveBeenCalledTimes(1);
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(onboarding).toEqual(before);
    expect(onboarding.context).toEqual({ existing: 'value' });
    expect(onboarding.currentStep).toBe('capture_alias');
    expect(onboarding.status).toBe('awaiting_user');
  });

  it('awaits runtime evaluation before applying onboarding mutations and save', async () => {
    let resolveEvaluation: ((value: WorkflowEvaluationResult | undefined) => void) | undefined;
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding, {
      evaluate: jest.fn().mockImplementation(
        () =>
          new Promise<WorkflowEvaluationResult | undefined>((resolve) => {
            resolveEvaluation = resolve;
          }),
      ),
    });

    const submitPromise = harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    await Promise.resolve();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();

    resolveEvaluation?.({
      acceptedData: { contactAddress: 'person@example.com' },
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      terminal: false,
    });

    await expect(submitPromise).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });
  });

  it('rejects completed onboarding without invoking the runtime or saving', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness(onboarding);
    await expect(
      harness.service.submit('onboarding-id', { identityConfirmed: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.workflowRegistryService.getById).not.toHaveBeenCalled();
    expect(harness.workflow.evaluate).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(onboarding).toMatchObject({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
    });
  });
});
