import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { submitOnboardingReview } from './onboarding-review';

const { mockedPost } = vi.hoisted(() => ({ mockedPost: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { post: mockedPost },
}));

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

const respondWith = (data: unknown) => mockedPost.mockResolvedValue({ data });

const rejectWith = (status: number) =>
  mockedPost.mockRejectedValue(
    new AxiosError('Request failed', 'ERR', undefined, undefined, {
      status,
      statusText: '',
      data: {},
      headers: {},
      config: { headers: new AxiosHeaders() },
    }),
  );

beforeEach(() => {
  mockedPost.mockReset();
});

describe('submitOnboardingReview', () => {
  it('posts the decision to the path the engine declares', async () => {
    respondWith({ status: 'approved', currentStep: null });

    await submitOnboardingReview(ONBOARDING_ID, 'approve');

    expect(mockedPost).toHaveBeenCalledWith(`/v1/onboardings/${ONBOARDING_ID}/review/approve`);
  });

  it('escapes an id that would otherwise change the path it posts to', async () => {
    respondWith({ status: 'approved', currentStep: null });

    await submitOnboardingReview('../audit', 'reject');

    expect(mockedPost).toHaveBeenCalledWith('/v1/onboardings/..%2Faudit/review/reject');
  });

  it('reports where the onboarding stands after the decision', async () => {
    respondWith({ status: 'awaiting_manual_review', currentStep: 'awaiting_manual_review' });

    await expect(submitOnboardingReview(ONBOARDING_ID, 'invalid')).resolves.toEqual({
      status: 'awaiting_manual_review',
      currentStep: 'awaiting_manual_review',
    });
  });

  it('surfaces a missing onboarding as an ApiError', async () => {
    rejectWith(404);

    await expect(submitOnboardingReview(ONBOARDING_ID, 'approve')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
      message: expect.any(String),
    });
  });

  it('surfaces a step that declares no such transition as an ApiError', async () => {
    rejectWith(409);

    await expect(submitOnboardingReview(ONBOARDING_ID, 'reject')).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      message: expect.any(String),
    });
  });

  it('raises a malformed payload rather than reporting an outcome drawn from it', async () => {
    respondWith({ status: 'approved' });

    await expect(submitOnboardingReview(ONBOARDING_ID, 'approve')).rejects.toBeInstanceOf(ApiError);
  });
});
