import { isAxiosError } from 'axios';
import { z } from 'zod';
import { describeRequestFailure } from '@/services/api/describe-request-failure';
import { httpClient } from '@/services/api/http-client';
import { ADMIN_ONBOARDINGS_ENDPOINT } from './admin-onboardings';

export type ManualReviewAction = 'approve' | 'reject' | 'invalid';

const manualReviewOutcomeSchema = z.object({
  status: z.string().min(1),
  currentStep: z.string().nullable(),
});

/** Where the onboarding stands once its manual review decision has been applied. */
export type ManualReviewOutcome = z.infer<typeof manualReviewOutcomeSchema>;

export class OnboardingReviewError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'OnboardingReviewError';
    this.status = status;
  }
}

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
    const status = isAxiosError(cause) ? cause.response?.status : undefined;
    throw new OnboardingReviewError(describeRequestFailure(status, cause, 'onboardings'), status);
  }

  const parsed = manualReviewOutcomeSchema.safeParse(response.data);
  if (!parsed.success) {
    throw new OnboardingReviewError('Response contains a malformed review outcome.');
  }

  return parsed.data;
}
