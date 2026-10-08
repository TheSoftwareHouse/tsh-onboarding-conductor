import { z } from 'zod';
import { invalidPayloadError, toApiError } from '@/services/api/api-error';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_ONBOARDINGS_ENDPOINT } from './admin-onboardings';

export type ManualReviewAction = 'approve' | 'reject' | 'invalid';

const manualReviewOutcomeSchema = z.object({
  status: z.string().min(1),
  currentStep: z.string().nullable(),
});

/** Where the onboarding stands once its manual review decision has been applied. */
export type ManualReviewOutcome = z.infer<typeof manualReviewOutcomeSchema>;

/** Records a manual review decision and answers with where the onboarding now stands. */
export async function submitOnboardingReview(
  onboardingId: string,
  action: ManualReviewAction,
): Promise<ManualReviewOutcome> {
  let response;
  try {
    response = await httpClient.post<unknown>(
      `${ADMIN_ONBOARDINGS_ENDPOINT}/${encodeURIComponent(onboardingId)}/review/${action}`,
    );
  } catch (cause) {
    throw toApiError(cause, 'onboardings');
  }

  const parsed = manualReviewOutcomeSchema.safeParse(response.data);
  if (!parsed.success) {
    throw invalidPayloadError('Response contains a malformed review outcome.');
  }

  return parsed.data;
}
