import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import type { ManualReviewAction } from '@/api/onboardings/onboarding-review';

/** Fixed render order, matching the design's Approve / Reject / Mark invalid layout. */
const MANUAL_REVIEW_ACTIONS_IN_ORDER: readonly ManualReviewAction[] = [
  'approve',
  'reject',
  'invalid',
];

const TRANSITION_STATUS_BY_ACTION: Record<ManualReviewAction, string> = {
  approve: 'manual.approve',
  reject: 'manual.reject',
  invalid: 'manual.invalid',
};

/** The review decisions the current step declares a transition for, in design order; empty when none apply. */
export function findAvailableReviewActions(
  definition: WorkflowDefinition | null,
  currentStep: string | null,
): ManualReviewAction[] {
  if (definition === null || currentStep === null) {
    return [];
  }

  const step = definition.steps.find((candidate) => candidate.name === currentStep);
  if (step === undefined) {
    return [];
  }

  const declaredStatuses = new Set(step.transitions.map((transition) => transition.status));

  return MANUAL_REVIEW_ACTIONS_IN_ORDER.filter((action) =>
    declaredStatuses.has(TRANSITION_STATUS_BY_ACTION[action]),
  );
}
