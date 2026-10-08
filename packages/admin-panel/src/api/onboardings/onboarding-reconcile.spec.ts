import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminOnboardingSummary } from './admin-onboardings';
import {
  OnboardingReconcileError,
  RECONCILE_OUTCOMES,
  reconcilePendingConnector,
} from './onboarding-reconcile';

const { mockedPost } = vi.hoisted(() => ({ mockedPost: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { post: mockedPost },
}));

const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';

const SUMMARY: AdminOnboardingSummary = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'approved',
  currentStep: null,
  expiresAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  completedAt: '2026-07-02T00:00:00.000Z',
  scores: {},
  pendingConnector: null,
};

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

describe('reconcilePendingConnector', () => {
  it('posts to the path the engine declares, with no body', async () => {
    respondWith({ outcome: 'applied', onboarding: SUMMARY });

    await reconcilePendingConnector(ONBOARDING_ID);

    expect(mockedPost).toHaveBeenCalledWith(
      `/v1/onboardings/${ONBOARDING_ID}/pending-connector/reconcile`,
    );
  });

  it('escapes an id that would otherwise change the path it posts to', async () => {
    respondWith({ outcome: 'applied', onboarding: SUMMARY });

    await reconcilePendingConnector('../audit');

    expect(mockedPost).toHaveBeenCalledWith(
      '/v1/onboardings/..%2Faudit/pending-connector/reconcile',
    );
  });

  it.each(RECONCILE_OUTCOMES)(
    'reports the %s outcome with the projected summary',
    async (outcome) => {
      respondWith({ outcome, onboarding: { ...SUMMARY, context: { secret: 'do-not-render' } } });

      await expect(reconcilePendingConnector(ONBOARDING_ID)).resolves.toEqual({
        outcome,
        onboarding: SUMMARY,
      });
    },
  );

  it('carries the connector the onboarding is still parked on through the summary', async () => {
    const pendingConnector = {
      connectorId: 'veriff_kyc',
      connectorName: 'Veriff',
      connectorOrder: 0,
      parkedAt: '2026-07-01T12:00:00.000Z',
    };
    respondWith({ outcome: 'still_pending', onboarding: { ...SUMMARY, pendingConnector } });

    await expect(reconcilePendingConnector(ONBOARDING_ID)).resolves.toEqual({
      outcome: 'still_pending',
      onboarding: { ...SUMMARY, pendingConnector },
    });
  });

  it('surfaces a missing onboarding as the module error class', async () => {
    rejectWith(404);

    await expect(reconcilePendingConnector(ONBOARDING_ID)).rejects.toMatchObject({
      name: 'OnboardingReconcileError',
      status: 404,
      message: expect.any(String),
    });
  });

  it('surfaces an onboarding no longer parked, or one whose adapter cannot reconcile, as the module error class', async () => {
    rejectWith(409);

    await expect(reconcilePendingConnector(ONBOARDING_ID)).rejects.toMatchObject({
      name: 'OnboardingReconcileError',
      status: 409,
      message: expect.any(String),
    });
  });

  it('raises an outcome this build does not know rather than reporting it', async () => {
    respondWith({ outcome: 'deferred', onboarding: SUMMARY });

    await expect(reconcilePendingConnector(ONBOARDING_ID)).rejects.toBeInstanceOf(
      OnboardingReconcileError,
    );
  });

  it('raises a malformed payload rather than reporting an outcome drawn from it', async () => {
    respondWith({ outcome: 'applied' });

    await expect(reconcilePendingConnector(ONBOARDING_ID)).rejects.toBeInstanceOf(
      OnboardingReconcileError,
    );
  });
});
