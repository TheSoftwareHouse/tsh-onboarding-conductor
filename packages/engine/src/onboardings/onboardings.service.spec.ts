import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Workflow, WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { WorkflowRegistryService } from '../workflows/workflow-registry.service';
import { OnboardingDocumentEntity } from './entity/onboarding-document.entity';
import { OnboardingEntity } from './entity/onboarding.entity';
import { OnboardingDocumentsRepository } from './onboarding-documents.repository';
import { OnboardingsRepository } from './onboardings.repository';
import { OnboardingsService } from './onboardings.service';
import { ConnectorPayloadFieldNotFoundError } from '../connectors/errors/connector-payload-field-not-found.error';

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

  const createCompletedDocumentReservation = (
    overrides: Partial<OnboardingDocumentEntity> = {},
  ): OnboardingDocumentEntity =>
    Object.assign(new OnboardingDocumentEntity(), {
      id: '01912345-6789-7abc-8def-0fedcba98765',
      onboardingId: '01912345-6789-7abc-8def-0123456789ab',
      stepName: 'capture_alias',
      fieldName: 'identityDocument',
      status: 'completed',
      stagingObjectKey:
        'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/staged',
      finalObjectKey:
        'onboardings/01912345-6789-7abc-8def-0123456789ab/01912345-6789-7abc-8def-0fedcba98765/final',
      requestedContentType: 'image/png',
      requestedMaxSizeBytes: 256,
      verifiedContentType: 'image/png',
      verifiedSizeBytes: 256,
      verifiedEtag: 'etag-123',
      expiresAt: new Date('2026-07-20T13:00:00.000Z'),
      completedAt: new Date('2026-07-20T12:00:00.000Z'),
      ...overrides,
    });

  const createWorkflowMock = (overrides: Record<string, unknown> = {}): Workflow =>
    ({
      initialize: jest.fn().mockReturnValue({
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
      }),
      evaluate: jest.fn().mockResolvedValue({
        acceptedData: { contactAddress: 'person@example.com' },
        appliedStep: 'capture_alias',
        nextState: {
          context: { contactAddress: 'person@example.com' },
          status: 'awaiting_user',
          currentStep: 'confirm_identity',
          completedAt: null,
        },
      } satisfies WorkflowEvaluationResult),
      getActiveFileFieldMetadata: jest.fn().mockReturnValue({
        fieldName: 'identityDocument',
        field: {
          type: 'file',
          required: true,
          validation: {
            contentTypes: ['image/png', 'image/jpeg'],
            maxSizeBytes: 4096,
            maxImageWidth: 1024,
            maxImageHeight: 768,
          },
        },
      }),
      ...overrides,
    }) as unknown as Workflow;

  const createHarness = (
    onboarding?: OnboardingEntity,
    workflowOverrides: Partial<Workflow> = {},
    workflowRegistryOverrides: Partial<WorkflowRegistryService> = {},
    completedDocumentById: OnboardingDocumentEntity | null = null,
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
    const workflow = createWorkflowMock(workflowOverrides as unknown as Record<string, unknown>);

    const onboardingDocumentsRepository = {
      findByIdForUpdate: jest.fn().mockResolvedValue(completedDocumentById),
      saveLocked: jest.fn().mockImplementation(async (_tx, entity) => entity),
    } as unknown as OnboardingDocumentsRepository;

    const workflowRegistryService: WorkflowRegistryService = {
      getById: jest.fn().mockReturnValue(workflow),
      ...workflowRegistryOverrides,
    } as unknown as WorkflowRegistryService;

    return {
      service: new OnboardingsService(
        dataSource,
        repository,
        onboardingDocumentsRepository,
        workflowRegistryService,
      ),
      transaction,
      repository,
      onboardingDocumentsRepository,
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
    const harness = createHarness(onboarding, {
      getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
    });

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
      onboardingContext: {},
    });
    expect(harness.repository.findByIdForUpdate).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });

    (harness.workflow.evaluate as jest.Mock).mockResolvedValueOnce({
      acceptedData: { identityConfirmed: true },
      appliedStep: 'confirm_identity',
      nextState: {
        context: {
          contactAddress: 'person@example.com',
          identityConfirmed: true,
        },
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
      },
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
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
    expect(harness.transaction).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(2);
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledTimes(2);
  });

  it('validates completed matching file reference before saving submit changes', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const reservation = createCompletedDocumentReservation({
      onboardingId: onboarding.id,
      stepName: onboarding.currentStep ?? 'capture_alias',
      fieldName: 'identityDocument',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const harness = createHarness(
      onboarding,
      {
        evaluate: jest.fn().mockResolvedValue({
          acceptedData: {
            identityDocument: reservation.id,
            documentLabel: 'passport',
          },
          appliedStep: 'capture_alias',
          nextState: {
            context: {
              existing: 'value',
              identityDocument: reservation.id,
              documentLabel: 'passport',
            },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T12:00:00.000Z'),
          },
        } satisfies WorkflowEvaluationResult),
      },
      {},
      reservation,
    );

    const result = await harness.service.submit('onboarding-id', {
      identityDocument: reservation.id,
      documentLabel: 'passport',
    });

    expect(result).toEqual({
      appliedStep: 'capture_alias',
      status: 'approved',
      currentStep: null,
    });
    expect(harness.onboardingDocumentsRepository.findByIdForUpdate).toHaveBeenCalledWith(
      manager,
      reservation.id,
    );
    expect(onboarding.context).toEqual({
      existing: 'value',
      identityDocument: reservation.id,
      documentLabel: 'passport',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it.each([
    ['missing reservation', null],
    [
      'pending reservation',
      createCompletedDocumentReservation({
        status: 'pending',
        completedAt: null,
      }),
    ],
    [
      'reservation for other onboarding',
      createCompletedDocumentReservation({
        onboardingId: '01912345-6789-7abc-8def-111111111111',
      }),
    ],
    [
      'reservation for other step',
      createCompletedDocumentReservation({
        stepName: 'different_step',
      }),
    ],
    [
      'reservation for other field',
      createCompletedDocumentReservation({
        fieldName: 'otherDocument',
      }),
    ],
    [
      'missing final object identity',
      createCompletedDocumentReservation({
        finalObjectKey: null,
      }),
    ],
    [
      'missing verified etag identity',
      createCompletedDocumentReservation({
        verifiedEtag: null,
      }),
    ],
  ])(
    'rejects submit file reference for %s without mutating onboarding',
    async (_reason, reservation) => {
      const onboarding = createOnboarding({
        context: { existing: 'value' },
      });
      const documentId = '01912345-6789-7abc-8def-0fedcba98765';
      const harness = createHarness(
        onboarding,
        {
          evaluate: jest.fn().mockResolvedValue({
            acceptedData: {
              identityDocument: documentId,
              documentLabel: 'passport',
            },
            appliedStep: 'capture_alias',
            nextState: {
              context: {
                existing: 'value',
                identityDocument: documentId,
                documentLabel: 'passport',
              },
              status: 'approved',
              currentStep: null,
              completedAt: new Date('2026-07-20T12:00:00.000Z'),
            },
          } satisfies WorkflowEvaluationResult),
        },
        {},
        reservation,
      );

      const before = {
        context: { ...onboarding.context },
        status: onboarding.status,
        currentStep: onboarding.currentStep,
        completedAt: onboarding.completedAt,
      };

      await expect(
        harness.service.submit('onboarding-id', {
          identityDocument: documentId,
          documentLabel: 'passport',
        }),
      ).rejects.toMatchObject({
        response: {
          code: 'INVALID_DOCUMENT_REFERENCE',
          message: 'INVALID_DOCUMENT_REFERENCE',
        },
        status: 400,
      });

      expect(onboarding.context).toEqual(before.context);
      expect(onboarding.status).toBe(before.status);
      expect(onboarding.currentStep).toBe(before.currentStep);
      expect(onboarding.completedAt).toBe(before.completedAt);
      expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    },
  );

  it('does not query document reservation on primitive-only submit', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness(onboarding, {
      getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
      evaluate: jest.fn().mockResolvedValue({
        acceptedData: { contactAddress: 'person@example.com' },
        appliedStep: 'capture_alias',
        nextState: {
          context: { contactAddress: 'person@example.com' },
          status: 'awaiting_user',
          currentStep: 'confirm_identity',
          completedAt: null,
        },
      } satisfies WorkflowEvaluationResult),
    });

    await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    expect(harness.onboardingDocumentsRepository.findByIdForUpdate).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
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
      getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
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
      nextState: {
        context: { contactAddress: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
      },
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

  it('bubbles technical runtime mapping error and does not persist state', async () => {
    const onboarding = createOnboarding({ context: { email: 'person@example.com' } });
    const harness = createHarness(onboarding, {
      evaluate: jest
        .fn()
        .mockRejectedValue(
          new ConnectorPayloadFieldNotFoundError('acceptedTerms', 'mock_kyc_2', 'tsh_kyc_2'),
        ),
    });

    await expect(harness.service.submit('onboarding-id', { acceptedTerms: true })).rejects.toThrow(
      'Connector payload field not found in context: sourceField=acceptedTerms, type=mock_kyc_2, name=tsh_kyc_2',
    );

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(onboarding).toMatchObject({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { email: 'person@example.com' },
      completedAt: null,
    });
  });

  it('accepts submit for completed reservation even when reservation expiry is in the past', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const reservation = createCompletedDocumentReservation({
      onboardingId: onboarding.id,
      stepName: onboarding.currentStep ?? 'capture_alias',
      fieldName: 'identityDocument',
      expiresAt: new Date(Date.now() - 60_000),
      completedAt: new Date(Date.now() - 30_000),
    });
    const harness = createHarness(
      onboarding,
      {
        evaluate: jest.fn().mockResolvedValue({
          acceptedData: {
            identityDocument: reservation.id,
            documentLabel: 'passport',
          },
          appliedStep: 'capture_alias',
          nextState: {
            context: {
              existing: 'value',
              identityDocument: reservation.id,
              documentLabel: 'passport',
            },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T12:00:00.000Z'),
          },
        } satisfies WorkflowEvaluationResult),
      },
      {},
      reservation,
    );

    const result = await harness.service.submit('onboarding-id', {
      identityDocument: reservation.id,
      documentLabel: 'passport',
    });

    expect(result).toEqual({
      appliedStep: 'capture_alias',
      status: 'approved',
      currentStep: null,
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });
});
