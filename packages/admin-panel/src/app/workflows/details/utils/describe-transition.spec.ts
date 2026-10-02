import { describe, expect, it } from 'vitest';
import type { WorkflowTransitionDefinition } from '@/api/workflows/workflow-definitions';
import { describeTransition } from './describe-transition';

function transition(
  overrides: Partial<WorkflowTransitionDefinition> = {},
): WorkflowTransitionDefinition {
  return { status: 'success', target: 'next', reason: null, ...overrides };
}

describe('describeTransition', () => {
  it('renders a plain status', () => {
    const only = transition();
    expect(describeTransition({ transitions: [only] }, only)).toBe('success');
    const manual = transition({ status: 'manual.approve' });
    expect(describeTransition({ transitions: [manual] }, manual)).toBe('manual.approve');
  });

  it('renders a guard', () => {
    const guarded = transition({ when: { field: 'documentType', equals: 'PASSPORT' } });
    expect(describeTransition({ transitions: [guarded] }, guarded)).toBe(
      'success when documentType = PASSPORT',
    );
  });

  it('renders reasons and marks the unguarded arm after them as the fallback', () => {
    const withReason = transition({
      status: 'rejected',
      reason: ['CHALLENGE_EXPIRED', 'CHALLENGE_NOT_FOUND'],
    });
    const fallback = transition({ status: 'rejected' });
    const step = { transitions: [transition(), withReason, fallback] };
    expect(describeTransition(step, withReason)).toBe(
      'rejected · reason CHALLENGE_EXPIRED, CHALLENGE_NOT_FOUND',
    );
    expect(describeTransition(step, fallback)).toBe('rejected · fallback arm');
    expect(describeTransition(step, step.transitions[0])).toBe('success');
  });

  it('marks an unguarded arm after guarded arms of the same status', () => {
    const guarded = transition({ when: { field: 'a', equals: 1 } });
    const fallback = transition();
    expect(describeTransition({ transitions: [guarded, fallback] }, fallback)).toBe(
      'success · fallback arm',
    );
  });

  it('does not throw on a malformed guard', () => {
    const odd = transition({ when: 'garbage' });
    expect(describeTransition({ transitions: [odd] }, odd)).toBe('success when custom condition');
  });
});
