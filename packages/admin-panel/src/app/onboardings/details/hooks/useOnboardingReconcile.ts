import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import {
  onboardingMutations,
  reviewInvalidationKeys,
} from '@/api/onboardings/onboarding-mutations';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import {
  showErrorToast,
  showProgressToast,
  showSuccessToast,
} from '@/components/ui/Toast/toast-manager';
import { RECONCILE_ERROR_TITLE, RECONCILE_OUTCOME_TITLE } from '../constants/reconcile-toasts';

export interface UseOnboardingReconcileResult {
  /** True while the provider is being asked. */
  isPending: boolean;
  reconcile: () => void;
}

/**
 * Asks the provider for the parked connector's verdict. The engine answers with the summary as
 * it now stands, so that is written straight into the detail query rather than re-read; the trail,
 * the list and the audit log are invalidated through the factory's meta, since every outcome
 * writes an audit row. A 409 means the onboarding moved underneath, so it invalidates what a
 * review decision does.
 */
export function useOnboardingReconcile(onboardingId: string): UseOnboardingReconcileResult {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    ...onboardingMutations.reconcile(onboardingId),
    onSuccess: ({ outcome, onboarding }) => {
      queryClient.setQueryData(onboardingQueries.detail(onboardingId).queryKey, onboarding);
      // The provider is still working on it, so the outcome reads as in progress, not as done.
      if (outcome === 'still_pending') {
        showProgressToast(RECONCILE_OUTCOME_TITLE[outcome]);
      } else {
        showSuccessToast(RECONCILE_OUTCOME_TITLE[outcome]);
      }
    },
    onError: (error) => {
      if (error.status === HttpStatusCode.Conflict) {
        for (const queryKey of reviewInvalidationKeys(onboardingId)) {
          void queryClient.invalidateQueries({ queryKey });
        }
      }
      showErrorToast(RECONCILE_ERROR_TITLE, error.message);
    },
  });

  return { isPending: mutation.isPending, reconcile: () => mutation.mutate() };
}
