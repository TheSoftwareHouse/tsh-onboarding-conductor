import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnboardingReviewActions } from './OnboardingReviewActions';
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
    initialStep: 'awaiting_manual_review',
    scores: {},
    steps,
  };
}

afterEach(() => {
  cleanup();
});

describe('OnboardingReviewActions', () => {
  it('renders one button per manual transition the current step declares, in the fixed order', () => {
    const doc = definition([
      step({
        transitions: [
          { status: 'manual.approve', target: 'approved' },
          { status: 'manual.reject', target: 'rejected' },
          { status: 'manual.invalid', target: 'invalid' },
        ],
      }),
    ]);

    render(
      <OnboardingReviewActions
        definition={doc}
        currentStep="awaiting_manual_review"
        pendingAction={null}
        onSubmit={() => {}}
      />,
    );

    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Approve',
      'Reject',
      'Mark invalid',
    ]);
  });

  it('renders nothing when the current step declares no manual transition', () => {
    const doc = definition([step({ transitions: [] })]);

    const { container } = render(
      <OnboardingReviewActions
        definition={doc}
        currentStep="awaiting_manual_review"
        pendingAction={null}
        onSubmit={() => {}}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it('submits the clicked decision and disables every button while one is pending', async () => {
    const user = userEvent.setup();
    const doc = definition([
      step({
        transitions: [
          { status: 'manual.approve', target: 'approved' },
          { status: 'manual.reject', target: 'rejected' },
        ],
      }),
    ]);
    const onSubmit = vi.fn();

    render(
      <OnboardingReviewActions
        definition={doc}
        currentStep="awaiting_manual_review"
        pendingAction={null}
        onSubmit={onSubmit}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(onSubmit).toHaveBeenCalledWith('approve');
  });

  it('disables every button while an action is pending', () => {
    const doc = definition([
      step({
        transitions: [
          { status: 'manual.approve', target: 'approved' },
          { status: 'manual.reject', target: 'rejected' },
        ],
      }),
    ]);

    render(
      <OnboardingReviewActions
        definition={doc}
        currentStep="awaiting_manual_review"
        pendingAction="approve"
        onSubmit={() => {}}
      />,
    );

    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeDisabled();
  });
});
