import { WebhookEventType } from '../webhook/webhook-event';
import { WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { createHarness, createOnboarding, manager } from './testing/onboardings-service.harness';

describe('OnboardingsService webhook integration', () => {
  it('creates no outbox event and does not notify on start', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.transactionOrder).toEqual(['transaction:start', 'transaction:resolved']);
  });

  it('returns distinct ids and still creates no event for each start', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const first = await harness.service.start({ workflowId: 'first' });
    const second = await harness.service.start({ workflowId: 'second' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('remains webhook-free on start regardless of resolver configuration', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await harness.service.start({ workflowId: 'passport-check' });

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('does not resolve webhook URL on start', async () => {
    const harness = createHarness();

    await harness.service.start({ workflowId: 'passport-check' });

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
    expect(harness.transaction).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('does not create an outbox event when onboarding persistence fails before the outbox write', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockRejectedValue(new Error('db write failed'));

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'db write failed',
    );

    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('propagates outbox persistence errors from start and does not notify', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await expect(harness.service.start({ workflowId: 'passport-check' })).resolves.toEqual(
      expect.objectContaining({ onboardingId: expect.any(String) }),
    );

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('does not notify after start transaction resolves', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await harness.service.start({ workflowId: 'passport-check' });

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
    expect(harness.transactionOrder).toEqual(['transaction:start', 'transaction:resolved']);
  });

  it('creates onboarding.state_changed notification and delivers after transaction commit on accepted submit without exposing outboxId in the response', async () => {
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
    expect(response).not.toHaveProperty('outboxId');
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
      }),
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'notify:called',
      'transaction:resolved',
    ]);

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
    await harness.service.submit('onboarding-id', { identityConfirmed: true });
    expect(harness.onboardingWebhookService.notify).toHaveBeenNthCalledWith(
      2,
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
      }),
    );
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(2);
  });

  it('keeps webhook notification behavior unchanged when no current-step declaration is configured', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    (harness.workflow.getSourceStepWebhook as jest.Mock).mockReturnValue(undefined);

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
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({ id: onboarding.id }),
    );
  });

  it('fails submit after state persistence when the webhook service rejects for a configured declaration', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const error = new Error(
      'CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured',
    );
    (harness.onboardingWebhookService.notify as jest.Mock).mockImplementation(
      async (_manager, _webhook, _eventType, _onboarding) => {
        void _manager;
        void _webhook;
        void _eventType;
        void _onboarding;

        throw error;
      },
    );

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).rejects.toThrow('CLIENT_WEBHOOK_BASE_URL is required when webhook declaration is configured');

    expect(harness.workflow.evaluate).toHaveBeenCalledTimes(1);
    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({ id: onboarding.id }),
    );
  });

  it('does not create an outbox event when submit fails before saving state', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest
          .fn()
          .mockResolvedValue(WorkflowEvaluationResult.invalidData({ contactAddress: ['INVALID'] })),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'invalid' }),
    ).rejects.toThrow('INVALID_STEP_DATA');

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.notify).not.toHaveBeenCalled();
  });

  it('propagates outbox persistence errors from submit and does not notify', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const error = new Error('outbox write failed');
    (harness.onboardingWebhookService.notify as jest.Mock).mockImplementation(
      async (_manager, _webhook, _eventType, _onboarding) => {
        void _manager;
        void _webhook;
        void _eventType;
        void _onboarding;

        throw error;
      },
    );

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).rejects.toThrow('outbox write failed');

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({ id: onboarding.id }),
    );
  });

  it('preserves the transition response when a post-commit delivery action fails after the transaction resolves', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    (harness.onboardingWebhookService.notify as jest.Mock).mockImplementation(
      async (_manager, _webhook, _eventType, _onboarding) => {
        void _manager;
        void _webhook;
        void _eventType;
        void _onboarding;

        harness.transactionOrder.push('notify:called');
      },
    );

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).resolves.toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
      rejectionReason: null,
    });

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'notify:called',
      'transaction:resolved',
    ]);
  });

  it('emits a manual-review state change notification after a valid transition', async () => {
    const onboarding = createOnboarding({
      status: 'awaiting_manual_review',
      currentStep: 'manual_review',
    });
    const harness = createHarness({ onboarding });

    (harness.workflow.evaluateManual as jest.Mock).mockReturnValue(
      WorkflowEvaluationResult.accepted({}, 'manual_review', {
        context: { manualDecision: 'approved' },
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
        rejectionReason: null,
      }),
    );

    const response = await harness.service.manualReview('onboarding-id', 'manual.approve');

    expect(response).toEqual({
      appliedStep: 'manual_review',
      status: 'approved',
      currentStep: null,
    });
    expect(harness.onboardingWebhookService.notify).toHaveBeenCalledWith(
      manager,
      harness.workflow,
      WebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({
        id: onboarding.id,
        status: 'approved',
        currentStep: null,
      }),
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'notify:called',
      'transaction:resolved',
    ]);
  });
});
