import { describe, expect, it } from 'vitest';
import { findAvailableReviewActions } from './manual-review-actions';
import type {
  WorkflowDefinition,
  WorkflowStepDefinition,
} from '@/api/workflows/workflow-definitions';

function step(overrides: Partial<WorkflowStepDefinition> = {}): WorkflowStepDefinition {
  return {
    name: 'awaiting_manual_review',
    status: 'awaiting_manual_review',
    terminal: false,
    transitions: [],
    ...overrides,
  };
}

function definition(steps: WorkflowStepDefinition[]): WorkflowDefinition {
  return {
    workflowId: 'manual-review',
    workflowVersion: 1,
    name: null,
    initialStep: 'awaiting_manual_review',
    scores: {},
    steps,
  };
}

describe('findAvailableReviewActions', () => {
  it('reports all three actions when the current step declares all three', () => {
    const doc = definition([
      step({
        transitions: [
          { status: 'manual.approve', target: 'approved' },
          { status: 'manual.reject', target: 'rejected' },
          { status: 'manual.invalid', target: 'invalid' },
        ],
      }),
    ]);

    expect(findAvailableReviewActions(doc, 'awaiting_manual_review')).toEqual([
      'approve',
      'reject',
      'invalid',
    ]);
  });

  it('reports only the one action a step declares', () => {
    const doc = definition([
      step({ transitions: [{ status: 'manual.approve', target: 'approved' }] }),
    ]);

    expect(findAvailableReviewActions(doc, 'awaiting_manual_review')).toEqual(['approve']);
  });

  it('reports no actions for a step that declares none of the three', () => {
    const doc = definition([step({ transitions: [{ status: 'success', target: 'next_step' }] })]);

    expect(findAvailableReviewActions(doc, 'awaiting_manual_review')).toEqual([]);
  });

  it('reports no actions for a null current step', () => {
    const doc = definition([
      step({ transitions: [{ status: 'manual.approve', target: 'approved' }] }),
    ]);

    expect(findAvailableReviewActions(doc, null)).toEqual([]);
  });

  it('reports no actions for a null definition', () => {
    expect(findAvailableReviewActions(null, 'awaiting_manual_review')).toEqual([]);
  });
});
