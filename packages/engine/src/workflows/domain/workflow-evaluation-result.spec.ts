import { WorkflowEvaluationResult } from './workflow-evaluation-result';

describe('WorkflowEvaluationResult', () => {
  it('returns an explicit rejection reason unchanged', () => {
    const result = WorkflowEvaluationResult.rejected(
      { email: 'person@example.com' },
      'verify_code',
      {
        context: { email: 'person@example.com' },
        status: 'rejected',
        currentStep: null,
        completedAt: new Date('2026-07-20T09:00:00.000Z'),
        rejectionReason: 'ATTEMPTS_EXHAUSTED',
        score: 0,
        scoreByStep: {},
      },
      'ATTEMPTS_EXHAUSTED',
    );

    expect(result.getRejectionReason()).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('returns undefined for rejected results without a stored reason', () => {
    const result = WorkflowEvaluationResult.rejected(
      { email: 'person@example.com' },
      'verify_code',
      {
        context: { email: 'person@example.com' },
        status: 'rejected',
        currentStep: null,
        completedAt: new Date('2026-07-20T09:00:00.000Z'),
        rejectionReason: null,
        score: 0,
        scoreByStep: {},
      },
      undefined as unknown as Parameters<typeof WorkflowEvaluationResult.rejected>[3],
    );

    expect(result.getRejectionReason()).toBeUndefined();
  });

  it('exposes explicit result-kind predicates for each closed form', () => {
    const acceptedResult = WorkflowEvaluationResult.accepted(
      { email: 'person@example.com' },
      'collect_email',
      {
        context: { email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'verify_code',
        completedAt: null,
        rejectionReason: null,
        score: 0,
        scoreByStep: {},
      },
    );
    const terminalInvalidResult = WorkflowEvaluationResult.terminalInvalid('UNKNOWN_STATE', {
      nextState: {
        context: { persisted: true },
        status: 'invalid',
        currentStep: null,
        completedAt: new Date('2026-07-20T09:00:00.000Z'),
        rejectionReason: null,
        score: 0,
        scoreByStep: {},
      },
    });
    const retryableResult = WorkflowEvaluationResult.retryableInvalidData(
      { email: ['INVALID'] },
      'collect_email',
    );
    const manualResult = WorkflowEvaluationResult.manualTransitionUnavailable({
      appliedStep: 'review',
    });
    const unknownResult = WorkflowEvaluationResult.unknownEvaluation();

    expect(acceptedResult.getRejectionReason()).toBeUndefined();
    expect(terminalInvalidResult.getRejectionReason()).toBeUndefined();
    expect(retryableResult.getRejectionReason()).toBeUndefined();
    expect(terminalInvalidResult.isTerminalInvalid()).toBe(true);
    expect(retryableResult.isRetryableInvalidData()).toBe(true);
    expect(manualResult.isManualTransitionUnavailable()).toBe(true);
    expect(unknownResult.isUnknownEvaluation()).toBe(true);
    expect(retryableResult.getNextState()).toBeUndefined();
    expect(retryableResult.getAppliedStep()).toBe('collect_email');
    expect(retryableResult.getErrors()).toEqual({ email: ['INVALID'] });
  });
});
