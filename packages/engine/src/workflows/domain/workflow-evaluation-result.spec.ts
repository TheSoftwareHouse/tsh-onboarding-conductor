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
      },
      undefined as unknown as Parameters<typeof WorkflowEvaluationResult.rejected>[3],
    );

    expect(result.getRejectionReason()).toBeUndefined();
  });

  it('returns undefined for accepted, invalid, and invalid-data results', () => {
    const acceptedResult = WorkflowEvaluationResult.accepted(
      { email: 'person@example.com' },
      'collect_email',
      {
        context: { email: 'person@example.com' },
        status: 'awaiting_user',
        currentStep: 'verify_code',
        completedAt: null,
        rejectionReason: null,
      },
    );
    const invalidResult = WorkflowEvaluationResult.invalid('UNKNOWN_STATE');
    const invalidDataResult = WorkflowEvaluationResult.invalidData({ email: ['INVALID'] });

    expect(acceptedResult.getRejectionReason()).toBeUndefined();
    expect(invalidResult.getRejectionReason()).toBeUndefined();
    expect(invalidDataResult.getRejectionReason()).toBeUndefined();
  });
});
