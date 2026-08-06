import { BadRequestException } from '@nestjs/common';
import { WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { WorkflowNotFoundException } from '../workflows/errors/workflow-not-found.exception';
import { createHarness, createOnboarding, manager } from './testing/onboardings-service.harness';

describe('OnboardingsService webhook integration', () => {
  it('notifies once after start commits', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const response = await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        id: response.onboardingId,
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        completedAt: null,
      }),
      harness.workflow,
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('does not notify at all when start persistence fails', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockRejectedValue(new Error('db write failed'));

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'db write failed',
    );

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('writes submit transition audit and notifies within the transaction for accepted submits', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });

    const response = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });
    expect(response).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      onboarding,
      harness.workflow,
    );
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.auditService.log).toHaveBeenCalledWith(
      manager,
      expect.objectContaining({
        action: 'onboarding.state_transition',
        previousOnboarding: expect.objectContaining({
          status: 'awaiting_user',
          currentStep: 'capture_alias',
        }),
        newOnboarding: onboarding,
        appliedStep: 'capture_alias',
      }),
    );
    const workflowResolutionCall = (harness.workflowRegistryService.getById as jest.Mock).mock
      .invocationCallOrder[0];
    const transactionStartCall = (harness.transaction as jest.Mock).mock.invocationCallOrder[0];
    expect(workflowResolutionCall).toBeLessThan(transactionStartCall);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'notify:called',
      'transaction:resolved',
    ]);
  });

  it('delegates transition policy derivation to webhook notify', async () => {
    const onboarding = createOnboarding();
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

    const response = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    expect(response).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      onboarding,
      harness.workflow,
    );
  });

  it('writes submit audit and notifies in the approved order', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      onboarding,
      harness.workflow,
    );
    expect(harness.auditService.log).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'notify:called',
      'transaction:resolved',
    ]);
  });

  it('rethrows onboarding persistence failures and notifies error', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const saveFailure = new Error('save failed');
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(saveFailure);

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).rejects.toBe(saveFailure);

    expect(harness.auditService.log).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      saveFailure,
      onboarding,
      harness.workflow,
    );
    expect(harness.transactionOrder).toEqual(['transaction:start', 'notifyError:called']);
  });

  it('propagates audit persistence failure without delivery and notifies error', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const auditFailure = new Error('audit write failed');
    (harness.auditService.log as jest.Mock).mockRejectedValueOnce(auditFailure);

    await expect(
      harness.service.submit('onboarding-id', {
        contactAddress: 'person@example.com',
      }),
    ).rejects.toBe(auditFailure);

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      auditFailure,
      onboarding,
      harness.workflow,
    );
    expect(harness.transactionOrder).toEqual(['transaction:start', 'notifyError:called']);
  });

  it('delegates INVALID_STEP_DATA to notifyError with prepared context', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
      currentStep: 'verify_code',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockResolvedValue(
            WorkflowEvaluationResult.retryableInvalidData(
              { verificationCode: ['INVALID'] },
              'verify_code',
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

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'submit',
      outcome: 'retryable_invalid_data',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(BadRequestException),
      onboarding,
      harness.workflow,
    );
    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
  });

  it('emits no notification for not-found because no snapshot is available', async () => {
    const harness = createHarness();

    await expect(harness.service.submit('missing', {})).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'submit',
      outcome: 'onboarding_not_found',
      resourceId: 'missing',
    });
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('emits no notification when submit preflight workflow resolution fails', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({
      onboarding,
      workflowRegistryOverrides: {
        getById: jest.fn().mockImplementation(() => {
          throw new WorkflowNotFoundException();
        }),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { email: 'person@example.com' }),
    ).rejects.toMatchObject({
      response: {
        code: 'WORKFLOW_NOT_FOUND',
      },
      status: 404,
    });

    expect(harness.transaction).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
  });

  it('calls notifyError when transaction setup fails after preflight onboarding/workflow resolution', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const transactionFailure = new Error('transaction setup failed');
    (harness.transaction as jest.Mock).mockRejectedValueOnce(transactionFailure);

    await expect(
      harness.service.submit('onboarding-id', { email: 'person@example.com' }),
    ).rejects.toBe(transactionFailure);

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      transactionFailure,
      onboarding,
      harness.workflow,
    );
  });

  it('delegates manual-review completed conflict to notifyError', async () => {
    const onboarding = createOnboarding();
    onboarding.status = 'approved';
    onboarding.currentStep = null;
    onboarding.completedAt = new Date('2026-07-20T10:00:00.000Z');
    const harness = createHarness({ onboarding });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.approve'),
    ).rejects.toMatchObject({
      response: {
        code: 'ONBOARDING_COMPLETED',
      },
      status: 409,
    });

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'onboarding_completed',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(Error),
      onboarding,
      harness.workflow,
    );
  });

  it('delegates unavailable manual transition to notifyError', async () => {
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
      },
      status: 409,
    });

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'transition_unavailable',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(Error),
      onboarding,
      harness.workflow,
    );
    expect(onboarding).toMatchObject({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
      context: { existing: 'value' },
      completedAt: null,
    });
  });

  it('delegates manual unknown evaluation to notifyError', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluateManual: jest.fn().mockReturnValue(WorkflowEvaluationResult.unknownEvaluation()),
      },
    });

    await expect(
      harness.service.manualReview('onboarding-id', 'manual.approve'),
    ).rejects.toMatchObject({
      response: {
        code: 'UNKNOWN_WORKFLOW_EVALUATION',
      },
      status: 409,
    });

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledTimes(1);
    expect(harness.auditService.logRejectedAttempt).toHaveBeenCalledWith(harness.dataSource, {
      operation: 'manual_review',
      outcome: 'unknown_workflow_evaluation',
      resourceId: 'onboarding-id',
    });
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      expect.any(Error),
      onboarding,
      harness.workflow,
    );
    const workflowResolutionCall = (harness.workflowRegistryService.getById as jest.Mock).mock
      .invocationCallOrder[0];
    const transactionStartCall = (harness.transaction as jest.Mock).mock.invocationCallOrder[0];
    expect(workflowResolutionCall).toBeLessThan(transactionStartCall);
  });

  it('notifies manual-review results after the transaction commits and avoids routing it through notifyError', async () => {
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
    (harness.onboardingWebhookService.notify as jest.Mock).mockImplementationOnce(async () => {
      harness.transactionOrder.push('notify:called');
    });

    await expect(harness.service.manualReview('onboarding-id', 'manual.approve')).resolves.toEqual({
      appliedStep: 'manual_review',
      status: 'approved',
      currentStep: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).not.toHaveBeenCalled();
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'audit:write',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('rethrows save failures and notifies error', async () => {
    const failure = new Error('save failed');
    const onboarding = createOnboarding({
      status: 'awaiting_user',
      currentStep: 'capture_alias',
      context: { existing: 'value' },
      completedAt: null,
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(
          WorkflowEvaluationResult.accepted(
            { acceptedTerms: true },
            'capture_alias',
            {
              context: { existing: 'value', acceptedTerms: true },
              status: 'awaiting_user',
              currentStep: 'confirm_identity',
              completedAt: null,
              rejectionReason: null,
            },
            { status: 'success', target: 'confirm_identity' },
          ),
        ),
      },
    });
    (harness.repository.saveLocked as jest.Mock).mockRejectedValueOnce(failure);

    await expect(harness.service.submit('onboarding-id', { acceptedTerms: true })).rejects.toBe(
      failure,
    );

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.auditService.log).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notifyError).toHaveBeenCalledWith(
      failure,
      onboarding,
      harness.workflow,
    );
    expect(harness.transactionOrder).toEqual(['transaction:start', 'notifyError:called']);
  });
});
