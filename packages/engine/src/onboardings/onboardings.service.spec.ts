import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { ConnectorExecutionResult } from '../connectors/ports/connector-execution-result';
import { ConnectorPayloadFieldNotFoundError } from '../connectors/errors/connector-payload-field-not-found.error';
import { createHarness, createOnboarding, manager } from './testing/onboardings-service.harness';

describe('OnboardingsService', () => {
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
        rejectionReason: repoResult[0].rejectionReason,
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
        rejectionReason: entity.rejectionReason,
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
        rejectionReason: null,
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
    const harness = createHarness({
      workflowRegistryOverrides: {
        getById: jest.fn().mockImplementation(() => {
          throw new WorkflowNotFoundException();
        }),
      },
    });

    await expect(harness.service.start({ workflowId: 'missing' })).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_NOT_FOUND',
        message: 'WORKFLOW_NOT_FOUND',
      },
      status: 404,
    });
    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.repository.createInitial).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('bubbles onboarding persistence errors from start without mutating state', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockRejectedValue(new Error('db write failed'));

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'db write failed',
    );

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
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
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'missing');
    expect(harness.repository.lockAndRefreshPreflight).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.workflowRegistryService.getById).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('does not run post-commit async start or notify when submit transaction rolls back', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({
      onboarding,
    });
    const rollbackError = new Error('rollback');
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(rollbackError);
    await expect(
      harness.service.submit('onboarding-id', { email: 'person@example.com' }),
    ).rejects.toBe(rollbackError);

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
  });

  it('uses the single preflight onboarding object for runtime evaluation and persistence', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
      },
    });

    const first = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });
    expect(first).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('passport-check', 3);
    expect(harness.workflow.evaluate).toHaveBeenCalledWith({
      currentStep: 'capture_alias',
      submittedData: { contactAddress: 'person@example.com' },
      onboardingContext: {},
      onboardingId: onboarding.id,
    });
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });

    (harness.workflow.evaluate as jest.Mock).mockResolvedValueOnce(
      WorkflowEvaluationResult.accepted({ identityConfirmed: true }, 'confirm_identity', {
        context: {
          contactAddress: 'person@example.com',
          identityConfirmed: true,
        },
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
        rejectionReason: null,
      }),
    );
    const second = await harness.service.submit('onboarding-id', {
      identityConfirmed: true,
    });
    expect(second).toEqual({
      appliedStep: 'confirm_identity',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
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

  it('passes the resolved connector result through to workflow evaluation as the minimal continuation bridge', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
      },
    });
    const resolvedResult = ConnectorExecutionResult.accepted();

    await harness.service.submit('onboarding-id', { acceptedTerms: true }, {
      resolvedConnector: { connectorOrder: 1, result: resolvedResult },
    } as const);

    expect(harness.workflow.evaluate).toHaveBeenCalledWith({
      currentStep: 'capture_alias',
      submittedData: { acceptedTerms: true },
      onboardingContext: {},
      onboardingId: onboarding.id,
      continuation: {
        resolvedConnector: {
          connectorOrder: 1,
          result: resolvedResult,
        },
      },
    });
  });

  it('accepts a submitted file reference after workflow evaluation without extra service validation', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.accepted(
            {
              identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
              documentLabel: 'passport',
            },
            'capture_alias',
            {
              context: {
                existing: 'value',
                identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
                documentLabel: 'passport',
              },
              status: 'approved',
              currentStep: null,
              completedAt: new Date('2026-07-20T12:00:00.000Z'),
              rejectionReason: null,
            },
          ),
        ),
      },
    });

    const result = await harness.service.submit('onboarding-id', {
      identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
      documentLabel: 'passport',
    });

    expect(result).toEqual({
      appliedStep: 'capture_alias',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });
    expect(onboarding.context).toEqual({
      existing: 'value',
      identityDocument: '01912345-6789-7abc-8def-0fedcba98765',
      documentLabel: 'passport',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('refreshes the same preflight entity under lock before submit evaluation', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { stale: true },
      completedAt: null,
    });
    const harness = createHarness({ onboarding });
    const expectedTransition = { status: 'success', target: 'confirm_identity' } as const;
    let transitionDuringRefresh: unknown;
    onboarding.setLifecycleTakenTransition(expectedTransition);
    onboarding.capturePreMutationWebhookSnapshot();

    (harness.repository.lockAndRefreshPreflight as jest.Mock).mockImplementationOnce(
      async (_tx, entity) => {
        transitionDuringRefresh = entity.getLifecycleTakenTransition();
        Object.assign(entity, {
          status: 'awaiting_manual_review',
          currentStep: 'manual_review',
          context: { persisted: 'db-state' },
          completedAt: null,
        });
      },
    );

    await harness.service.submit('onboarding-id', { manualDecision: 'approve' });

    const evaluateInput = (harness.workflow.evaluate as jest.Mock).mock.calls[0][0];
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(evaluateInput).toEqual(
      expect.objectContaining({
        currentStep: 'manual_review',
        onboardingContext: { persisted: 'db-state' },
      }),
    );
    expect(transitionDuringRefresh).toEqual(expectedTransition);
    expect(onboarding.getLifecycleTakenTransition()).toEqual(expectedTransition);
    expect(onboarding.getPreMutationWebhookSnapshot()).toEqual({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      completedAt: null,
    });
  });

  it('does not query document reservation on primitive-only submit', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
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
            },
          ),
        ),
      },
    });

    await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('returns INVALID_STEP_DATA for retryable non-final verifyCode invalid-data and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockResolvedValueOnce(
            WorkflowEvaluationResult.retryableInvalidData(
              { verificationCode: ['INVALID'] },
              'verify_code',
            ),
          )
          .mockResolvedValueOnce(
            WorkflowEvaluationResult.accepted(
              { otpConfirmed: true },
              'verify_code',
              {
                context: { existing: 'value', otpConfirmed: true },
                status: 'approved',
                currentStep: null,
                completedAt: new Date('2026-07-20T10:00:00.000Z'),
                rejectionReason: null,
              },
              { status: 'success', target: 'approved' },
            ),
          ),
      },
    });

    const firstAttempt = harness.service.submit('onboarding-id', { verificationCode: '000000' });
    await expect(firstAttempt).rejects.toBeInstanceOf(BadRequestException);
    await expect(firstAttempt).rejects.toMatchObject({
      response: {
        code: 'INVALID_STEP_DATA',
        message: 'INVALID_STEP_DATA',
        errors: { verificationCode: ['INVALID'] },
      },
      status: 400,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      onboarding,
      harness.workflow,
    );
    expect(onboarding.status).toBe('awaiting_user');
    expect(onboarding.currentStep).toBe('verify_code');
    expect(onboarding.context).toEqual({ existing: 'value' });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '123456' }),
    ).resolves.toEqual({
      appliedStep: 'verify_code',
      status: 'approved',
      currentStep: null,
      rejectionReason: null,
    });

    expect(harness.workflow.evaluate).toHaveBeenCalledTimes(2);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(
      harness.onboardingWebhookService.createPendingForLifecycleTransition,
    ).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.deliverEnqueued).toHaveBeenCalledTimes(1);
    expect(harness.auditService.writeAcceptedSubmitTransition).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(onboarding.status).toBe('approved');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({ existing: 'value', otpConfirmed: true });
    expect(onboarding.rejectionReason).toBeNull();
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
  });

  it('persists invalid UNKNOWN_STATE results with nullable appliedStep for missing server-held state', async () => {
    const onboarding = createOnboarding({
      context: { email: 'person@example.com' },
      currentStep: 'verify_code',
    });
    const rootNotifyWebhook = { path: 'root-state-changed' };
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getRootNotifyWebhook: jest.fn().mockReturnValue(rootNotifyWebhook),
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
            nextState: {
              context: { email: 'person@example.com' },
              status: 'invalid',
              currentStep: null,
              completedAt: new Date('2026-07-20T10:00:00.000Z'),
              rejectionReason: null,
            },
          }),
        ),
      },
    });

    await expect(harness.service.submit('onboarding-id', null)).resolves.toEqual({
      appliedStep: null,
      status: 'invalid',
      currentStep: null,
      rejectionReason: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(
      harness.onboardingWebhookService.createPendingForLifecycleTransition,
    ).toHaveBeenCalledTimes(1);
    expect(
      harness.onboardingWebhookService.createPendingForLifecycleTransition,
    ).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        id: onboarding.id,
        status: 'invalid',
        currentStep: null,
      }),
      harness.workflow,
    );
    expect(harness.onboardingWebhookService.deliverEnqueued).toHaveBeenCalledTimes(1);
    expect(harness.auditService.writeAcceptedSubmitTransition).not.toHaveBeenCalled();
    expect(onboarding.status).toBe('invalid');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({ email: 'person@example.com' });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
  });

  it('throws UnknownWorkflowEvaluationException and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '123456' }),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
  });

  it('uses nextState.rejectionReason when a rejected result accessor reason differs', async () => {
    const onboarding = createOnboarding({
      context: { email: 'person@example.com' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.rejected(
            {},
            'verify_code',
            {
              context: { email: 'person@example.com' },
              status: 'rejected',
              currentStep: null,
              completedAt: new Date('2026-07-20T09:00:00.000Z'),
              rejectionReason: 'CHALLENGE_EXPIRED',
            },
            'ATTEMPTS_EXHAUSTED',
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { verificationCode: '000000' }),
    ).resolves.toEqual({
      appliedStep: 'verify_code',
      status: 'rejected',
      currentStep: null,
      rejectionReason: 'CHALLENGE_EXPIRED',
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.status).toBe('rejected');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.rejectionReason).toBe('CHALLENGE_EXPIRED');
  });

  it('persists null rejection reasons for non-rejected results', async () => {
    const onboarding = createOnboarding({ currentStep: 'capture_alias' });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
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
            },
          ),
        ),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(onboarding.rejectionReason).toBeNull();
  });

  it('awaits runtime evaluation before applying onboarding mutations and save', async () => {
    let resolveEvaluation: ((value: WorkflowEvaluationResult) => void) | undefined;
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        getActiveFileFieldMetadata: jest.fn().mockReturnValue(undefined),
        evaluate: jest.fn().mockImplementation(
          () =>
            new Promise<WorkflowEvaluationResult>((resolve) => {
              resolveEvaluation = resolve;
            }),
        ),
      },
    });

    const submitPromise = harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    await new Promise<void>((resolve) => setImmediate(resolve));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();

    expect(resolveEvaluation).toBeDefined();
    resolveEvaluation!(
      WorkflowEvaluationResult.accepted({ contactAddress: 'person@example.com' }, 'capture_alias', {
        context: { contactAddress: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
        rejectionReason: null,
      }),
    );

    await expect(submitPromise).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(onboarding.context).toEqual({ contactAddress: 'person@example.com' });
  });

  it('rejects completed onboarding without invoking evaluate and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness({ onboarding });
    await expect(
      harness.service.submit('onboarding-id', { identityConfirmed: true }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(harness.workflowRegistryService.getById).toHaveBeenCalledWith('passport-check', 3);
    expect(harness.workflow.evaluate).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
    expect(onboarding).toMatchObject({
      status: 'approved',
      currentStep: null,
      context: { contactAddress: 'person@example.com', identityConfirmed: true },
    });
  });

  it('bubbles technical runtime mapping error and delegates notifyError', async () => {
    const onboarding = createOnboarding({ context: { email: 'person@example.com' } });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockRejectedValue(
            new ConnectorPayloadFieldNotFoundError('acceptedTerms', 'mock_kyc_2', 'tsh_kyc_2'),
          ),
      },
    });

    await expect(harness.service.submit('onboarding-id', { acceptedTerms: true })).rejects.toThrow(
      'Connector payload field not found in context: sourceField=acceptedTerms, type=mock_kyc_2, name=tsh_kyc_2',
    );

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConnectorPayloadFieldNotFoundError),
      onboarding,
      harness.workflow,
    );
    expect(onboarding).toMatchObject({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { email: 'person@example.com' },
      completedAt: null,
    });
  });

  it('persists a targeted manual review result and marks terminal completion', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockImplementation((input) =>
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: {
              ...(input.onboardingContext ?? {}),
              manualDecision: 'approved',
            },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T10:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.approve');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(harness.workflow.evaluateManual).toHaveBeenCalledWith(
      {
        currentStep: 'manual_review',
        submittedData: {},
        onboardingContext: { existing: 'value' },
      },
      'manual.approve',
    );
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(onboarding.status).toBe('approved');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'approved',
    });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T10:00:00.000Z'));
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'notify:called',
      'transaction:resolved',
    ]);
  });

  it('does not notify on manual review when transaction rolls back', async () => {
    const rollbackError = new Error('manual review rollback');
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: { existing: 'value', manualDecision: 'approved' },
            status: 'approved',
            currentStep: null,
            completedAt: new Date('2026-07-20T10:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(rollbackError);

    await expect(harness.service.manualReview('onboarding-id', 'manual.approve')).rejects.toBe(
      rollbackError,
    );

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
  });

  it('persists a targeted terminal manual invalid result and applies state updates', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: {
              existing: 'value',
              manualDecision: 'invalid',
            },
            status: 'invalid',
            currentStep: null,
            completedAt: new Date('2026-07-20T11:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.invalid');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'invalid',
      currentStep: null,
    });
    expect(onboarding.status).toBe('invalid');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'invalid',
    });
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T11:00:00.000Z'));
    expect(onboarding.rejectionReason).toBeNull();
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
  });

  it('still applies and notifies a valid manual result even when it looks recursive', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted(
            {},
            'manual_review',
            {
              context: {
                existing: 'value',
                manualDecision: 'returned',
              },
              status: 'awaiting_manual_review',
              currentStep: 'manual_review',
              completedAt: null,
              rejectionReason: null,
            },
            { status: 'manual.invalid', target: 'manual_review' },
          ),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.invalid');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
    });
    expect(onboarding.context).toEqual({
      existing: 'value',
      manualDecision: 'returned',
    });
    expect(onboarding.rejectionReason).toBeNull();
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ id: onboarding.id }),
      harness.workflow,
    );
  });

  it('returns the manual transition conflict without saving when no manual path is available', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest
          .fn()
          .mockReturnValue(WorkflowEvaluationResult.manualTransitionUnavailable()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.reject'),
    ).rejects.toMatchObject({
      response: {
        code: 'MANUAL_TRANSITION_NOT_AVAILABLE',
        message: 'MANUAL_TRANSITION_NOT_AVAILABLE',
      },
      status: 409,
    });

    expect(onboarding.status).toBe('awaiting_manual_review');
    expect(onboarding.currentStep).toBe('manual_review');
    expect(onboarding.context).toEqual({ existing: 'value' });
    expect(onboarding.completedAt).toBeNull();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
  });

  it('throws UnknownWorkflowEvaluationException for explicit unknown evaluation during manual review and delegates notifyError', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.reject'),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
        message: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(ConflictException),
      onboarding,
      harness.workflow,
    );
  });

  it('persists a rejected manual review outcome as a terminal state', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(
          WorkflowEvaluationResult.accepted({}, 'manual_review', {
            context: { existing: 'value' },
            status: 'rejected',
            currentStep: null,
            completedAt: new Date('2026-07-20T11:00:00.000Z'),
            rejectionReason: null,
          }),
        ),
      },
    });

    const result = await harness.service.manualReview('onboarding-id', 'manual.reject');

    expect(result).toEqual({
      appliedStep: 'manual_review',
      status: 'rejected',
      currentStep: null,
    });
    expect(onboarding.status).toBe('rejected');
    expect(onboarding.currentStep).toBeNull();
    expect(onboarding.completedAt).toEqual(new Date('2026-07-20T11:00:00.000Z'));
    expect(onboarding.rejectionReason).toBeNull();
  });

  it('uses preflight onboarding and rejects completed onboardings before evaluation', async () => {
    const onboarding = createOnboarding({
      status: 'approved',
      currentStep: null,
      context: { existing: 'value' },
      completedAt: new Date('2026-07-16T12:00:00.000Z'),
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn(),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.approve'),
    ).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_COMPLETED',
        message: 'ONBOARDING_COMPLETED',
      },
      status: 409,
    });

    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.repository.findById).toHaveBeenCalledWith(manager, 'onboarding-id');
    expect(harness.repository.lockAndRefreshPreflight).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.workflow.evaluateManual).not.toHaveBeenCalled();
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
  });
});
