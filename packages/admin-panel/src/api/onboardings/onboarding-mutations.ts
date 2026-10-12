import type { QueryKey } from '@tanstack/react-query';
import { auditQueries } from '@/api/audit/audit-queries';
import { mutationOptions } from '@/services/query-client/mutation-options';
import { onboardingQueries } from './onboarding-queries';
import { reconcilePendingConnector } from './onboarding-reconcile';
import { submitOnboardingReview, type ManualReviewAction } from './onboarding-review';

/** What a review decision changes; shared with the hook's 409 path so the two cannot drift. */
export function reviewInvalidationKeys(onboardingId: string): readonly QueryKey[] {
  return [
    onboardingQueries.detail(onboardingId).queryKey,
    onboardingQueries.lists(),
    auditQueries.all(),
  ];
}

/** Sibling module to `onboarding-review.ts` and `onboarding-reconcile.ts` on purpose, so `vi.mock` of either still intercepts `mutationFn`. */
export const onboardingMutations = {
  review: (onboardingId: string) =>
    mutationOptions({
      mutationFn: (action: ManualReviewAction) => submitOnboardingReview(onboardingId, action),
      meta: { invalidates: reviewInvalidationKeys(onboardingId) },
    }),
  /**
   * The engine answers with the summary as it now stands, so the hook writes that into the detail
   * query itself; what is invalidated here is everything else the verdict changed.
   */
  reconcile: (onboardingId: string) =>
    mutationOptions({
      mutationFn: () => reconcilePendingConnector(onboardingId),
      meta: {
        invalidates: [
          onboardingQueries.transitions(onboardingId).queryKey,
          onboardingQueries.lists(),
          auditQueries.all(),
        ],
      },
    }),
};
