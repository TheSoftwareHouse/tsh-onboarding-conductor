import type { ReactElement } from 'react';
import type { ManualReviewAction } from '@/api/onboardings/onboarding-review';
import type { WorkflowDefinition } from '@/api/workflows/workflow-definitions';
import { Button, type ButtonVariant } from '@/components/ui/Button/Button';
import { findAvailableReviewActions } from '../../../utils/manual-review-actions';

export interface OnboardingReviewActionsProps {
  definition: WorkflowDefinition | null;
  currentStep: string | null;
  /** True while any header action is in flight, since two writes must not race on one onboarding. */
  disabled: boolean;
  onSubmit: (action: ManualReviewAction) => void;
}

const REVIEW_ACTION_LABEL: Record<ManualReviewAction, string> = {
  approve: 'Approve',
  reject: 'Reject',
  invalid: 'Mark invalid',
};

const REVIEW_ACTION_VARIANT: Record<ManualReviewAction, ButtonVariant> = {
  approve: 'primary',
  reject: 'danger-outline',
  invalid: 'secondary',
};

/** Approve / Reject / Mark invalid, one button per manual transition the current step declares. */
export function OnboardingReviewActions({
  definition,
  currentStep,
  disabled,
  onSubmit,
}: OnboardingReviewActionsProps): ReactElement | null {
  const availableActions = findAvailableReviewActions(definition, currentStep);

  if (availableActions.length === 0) {
    return null;
  }

  return (
    <>
      {availableActions.map((action) => (
        <Button
          key={action}
          variant={REVIEW_ACTION_VARIANT[action]}
          size="lg"
          disabled={disabled}
          onClick={() => onSubmit(action)}
        >
          {REVIEW_ACTION_LABEL[action]}
        </Button>
      ))}
    </>
  );
}
