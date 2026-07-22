import { ClientWebhookEventType } from '../client-webhook-outbox/client-webhook-event';
import { WorkflowEvaluationResult } from '../workflows/domain/workflow';
import { createHarness, createOnboarding, manager } from './testing/onboardings-service.harness';

describe('OnboardingsService webhook integration', () => {
  it('creates onboarding.created outbox event and notifies after transaction commit on start', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const response = await harness.service.start({ workflowId: 'unused-name' });

    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledWith(
      manager,
      ClientWebhookEventType.ONBOARDING_CREATED,
      expect.objectContaining({
        id: response.onboardingId,
        workflowId: 'passport-check',
        workflowVersion: 3,
        status: 'awaiting_user',
        currentStep: 'capture_alias',
        completedAt: null,
      }),
    );
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledWith(
      `outbox-${ClientWebhookEventType.ONBOARDING_CREATED}`,
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('returns distinct ids and emits a separate onboarding.created event for each start', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    const first = await harness.service.start({ workflowId: 'first' });
    const second = await harness.service.start({ workflowId: 'second' });

    expect(first.onboardingId).not.toBe(second.onboardingId);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(2);
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(2);
  });

  it('does not call notify when endpoint configuration is absent', async () => {
    const harness = createHarness({ outboxIdPrefix: '' });
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);

    await harness.service.start({ workflowId: 'passport-check' });

    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('does not create an outbox event when onboarding persistence fails before the outbox write', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockRejectedValue(new Error('db write failed'));

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'db write failed',
    );

    expect(harness.onboardingWebhookService.createPendingEvent).not.toHaveBeenCalled();
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('propagates outbox persistence errors from start and does not notify', async () => {
    const harness = createHarness();
    const error = new Error('outbox write failed');
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);
    (harness.onboardingWebhookService.createPendingEvent as jest.Mock).mockRejectedValue(error);

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'outbox write failed',
    );

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledWith(
      manager,
      ClientWebhookEventType.ONBOARDING_CREATED,
      expect.objectContaining({ id: expect.any(String) }),
    );
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('propagates notify rejection from start after the transaction has resolved', async () => {
    const harness = createHarness();
    (harness.repository.createInitial as jest.Mock).mockImplementation(async (_tx, data) => data);
    (harness.clientWebhookNotifyService.notify as jest.Mock).mockImplementation(async () => {
      harness.transactionOrder.push('notify:called');
      throw new Error('notify failed');
    });

    await expect(harness.service.start({ workflowId: 'passport-check' })).rejects.toThrow(
      'notify failed',
    );

    expect(harness.repository.createInitial).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'transaction:resolved',
      'notify:called',
    ]);
  });

  it('creates onboarding.state_changed outbox event and notifies after transaction commit on accepted submit', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });

    const response = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });
    expect(response).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenNthCalledWith(
      1,
      manager,
      ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: 'awaiting_user',
        currentStep: 'confirm_identity',
        completedAt: null,
      }),
    );
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledWith(
      `outbox-${ClientWebhookEventType.ONBOARDING_STATE_CHANGED}`,
    );
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'transaction:resolved',
      'notify:called',
    ]);

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
    await harness.service.submit('onboarding-id', { identityConfirmed: true });
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenNthCalledWith(
      2,
      manager,
      ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({
        id: onboarding.id,
        workflowId: onboarding.workflowId,
        workflowVersion: onboarding.workflowVersion,
        status: 'approved',
        currentStep: null,
        completedAt: new Date('2026-07-20T10:00:00.000Z'),
      }),
    );
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(2);
  });

  it('keeps submit behavior unchanged and writes no event when endpoint is disabled', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding, outboxIdPrefix: '' });

    const response = await harness.service.submit('onboarding-id', {
      contactAddress: 'person@example.com',
    });

    expect(response).toEqual({
      appliedStep: 'capture_alias',
      status: 'awaiting_user',
      currentStep: 'confirm_identity',
    });
    expect(harness.repository.saveLocked).toHaveBeenCalledWith(manager, onboarding);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('does not create an outbox event when submit fails before saving state', async () => {
    const onboarding = createOnboarding({
      context: { existing: 'value' },
    });
    const harness = createHarness({
      onboarding,
      workflowOverrides: {
        evaluate: jest.fn().mockResolvedValue(undefined),
      },
    });

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'invalid' }),
    ).rejects.toThrow('INVALID_STEP_DATA');

    expect(harness.repository.saveLocked).not.toHaveBeenCalled();
    expect(harness.onboardingWebhookService.createPendingEvent).not.toHaveBeenCalled();
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('propagates outbox persistence errors from submit and does not notify', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    const error = new Error('outbox write failed');
    (harness.onboardingWebhookService.createPendingEvent as jest.Mock).mockRejectedValue(error);

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).rejects.toThrow('outbox write failed');

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledWith(
      manager,
      ClientWebhookEventType.ONBOARDING_STATE_CHANGED,
      expect.objectContaining({ id: onboarding.id }),
    );
    expect(harness.clientWebhookNotifyService.notify).not.toHaveBeenCalled();
  });

  it('propagates notify rejection from submit after the transaction has resolved', async () => {
    const onboarding = createOnboarding();
    const harness = createHarness({ onboarding });
    (harness.clientWebhookNotifyService.notify as jest.Mock).mockImplementation(async () => {
      harness.transactionOrder.push('notify:called');
      throw new Error('notify failed');
    });

    await expect(
      harness.service.submit('onboarding-id', { contactAddress: 'person@example.com' }),
    ).rejects.toThrow('notify failed');

    expect(harness.repository.saveLocked).toHaveBeenCalledTimes(1);
    expect(harness.onboardingWebhookService.createPendingEvent).toHaveBeenCalledTimes(1);
    expect(harness.clientWebhookNotifyService.notify).toHaveBeenCalledTimes(1);
    expect(harness.transactionOrder).toEqual([
      'transaction:start',
      'transaction:resolved',
      'notify:called',
    ]);
  });
});
