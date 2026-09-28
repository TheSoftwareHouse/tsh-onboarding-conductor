import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import { auditQueries } from '@/api/audit/audit-queries';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import {
  OnboardingReviewError,
  submitOnboardingReview,
  type ManualReviewAction,
  type ManualReviewOutcome,
} from '@/api/onboardings/onboarding-review';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { REVIEW_ERROR_TITLE, REVIEW_SUCCESS_TITLE } from '../constants/review-toasts';

export interface UseOnboardingReviewResult {
  /** The action currently in flight, or null when none is. */
  pendingAction: ManualReviewAction | null;
  submit: (action: ManualReviewAction) => void;
}

/** A manual review decision; invalidates what it changed on success, or on a 409 (the state moved underneath). */
export function useOnboardingReview(onboardingId: string): UseOnboardingReviewResult {
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ManualReviewAction | null>(null);

  function invalidate(): void {
    for (const queryKey of [
      onboardingQueries.detail(onboardingId).queryKey,
      onboardingQueries.lists(),
      auditQueries.all(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  const mutation = useMutation<ManualReviewOutcome, OnboardingReviewError, ManualReviewAction>({
    mutationFn: (action) => submitOnboardingReview(onboardingId, action),
    onSuccess: (_, action) => {
      invalidate();
      showSuccessToast(REVIEW_SUCCESS_TITLE[action]);
    },
    onError: (error) => {
      if (error.status === HttpStatusCode.Conflict) {
        invalidate();
      }
      showErrorToast(REVIEW_ERROR_TITLE, error.message);
    },
  });

  function submit(action: ManualReviewAction): void {
    setPendingAction(action);
    mutation.mutate(action, {
      onSettled: () => setPendingAction(null),
    });
  }

  return { pendingAction, submit };
}
