import { useMutation, useQueryClient } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import { auditQueries } from '@/api/audit/audit-queries';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import {
  OnboardingReconcileError,
  reconcilePendingConnector,
  type OnboardingReconcileResult,
} from '@/api/onboardings/onboarding-reconcile';
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
 * the list and the audit log are invalidated, since every outcome writes an audit row. A 409 means
 * the onboarding moved underneath, so it invalidates too, as the review hook does.
 */
export function useOnboardingReconcile(onboardingId: string): UseOnboardingReconcileResult {
  const queryClient = useQueryClient();

  function invalidate(queryKeys: readonly (readonly unknown[])[]): void {
    for (const queryKey of queryKeys) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  const mutation = useMutation<OnboardingReconcileResult, OnboardingReconcileError>({
    mutationFn: () => reconcilePendingConnector(onboardingId),
    onSuccess: ({ outcome, onboarding }) => {
      queryClient.setQueryData(onboardingQueries.detail(onboardingId).queryKey, onboarding);
      invalidate([
        onboardingQueries.transitions(onboardingId).queryKey,
        onboardingQueries.lists(),
        auditQueries.all(),
      ]);
      // The provider is still working on it, so the outcome reads as in progress, not as done.
      if (outcome === 'still_pending') {
        showProgressToast(RECONCILE_OUTCOME_TITLE[outcome]);
      } else {
        showSuccessToast(RECONCILE_OUTCOME_TITLE[outcome]);
      }
    },
    onError: (error) => {
      if (error.status === HttpStatusCode.Conflict) {
        invalidate([
          onboardingQueries.detail(onboardingId).queryKey,
          onboardingQueries.lists(),
          auditQueries.all(),
        ]);
      }
      showErrorToast(RECONCILE_ERROR_TITLE, error.message);
    },
  });

  return { isPending: mutation.isPending, reconcile: () => mutation.mutate() };
}
