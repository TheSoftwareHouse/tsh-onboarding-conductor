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

export interface UseOnboardingReviewResult {
  /** The action currently in flight, or null when none is. */
  pendingAction: ManualReviewAction | null;
  submit: (action: ManualReviewAction) => void;
  /** The most recent attempt's failure, or null once it succeeds or before any attempt. */
  error: OnboardingReviewError | null;
  /** Clears `error`, so a stale failure does not outlive a reload. */
  resetError: () => void;
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
    onSuccess: () => invalidate(),
    onError: (error) => {
      if (error.status === HttpStatusCode.Conflict) {
        invalidate();
      }
    },
  });

  function submit(action: ManualReviewAction): void {
    setPendingAction(action);
    mutation.mutate(action, {
      onSettled: () => setPendingAction(null),
    });
  }

  return { pendingAction, submit, error: mutation.error, resetError: mutation.reset };
}
