import type { ReconcileOutcome } from '@/api/onboardings/onboarding-reconcile';

/** The toast title per outcome of asking the provider for its verdict. */
export const RECONCILE_OUTCOME_TITLE: Record<ReconcileOutcome, string> = {
  applied: 'Verdict applied.',
  still_pending: 'Provider has not decided yet.',
  superseded: 'Onboarding moved on.',
};

/** The error title; shared by every refused or failed check. */
export const RECONCILE_ERROR_TITLE = 'Unable to check the provider:';
