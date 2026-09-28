import type { ManualReviewAction } from '@/api/onboardings/onboarding-review';

/** The Copy table's success title, one per review decision. */
export const REVIEW_SUCCESS_TITLE: Record<ManualReviewAction, string> = {
  approve: 'Onboarding approved.',
  reject: 'Onboarding rejected.',
  invalid: 'Onboarding marked invalid.',
};

/** The Copy table's error title; shared by every review decision. */
export const REVIEW_ERROR_TITLE = 'Unable to record the review decision:';
