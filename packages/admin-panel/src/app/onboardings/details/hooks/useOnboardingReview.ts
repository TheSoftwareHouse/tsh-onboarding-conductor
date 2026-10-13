import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import {
  onboardingMutations,
  reviewInvalidationKeys,
} from '@/api/onboardings/onboarding-mutations';
import { type ManualReviewAction } from '@/api/onboardings/onboarding-review';
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

  const mutation = useMutation({
    ...onboardingMutations.review(onboardingId),
    onSuccess: (_, action) => {
      showSuccessToast(REVIEW_SUCCESS_TITLE[action]);
    },
    onError: (error) => {
      if (error.status === HttpStatusCode.Conflict) {
        for (const queryKey of reviewInvalidationKeys(onboardingId)) {
          void queryClient.invalidateQueries({ queryKey });
        }
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
