import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingReconcile } from './useOnboardingReconcile';
import { auditQueries } from '@/api/audit/audit-queries';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';
import {
  reconcilePendingConnector,
  type OnboardingReconcileResult,
} from '@/api/onboardings/onboarding-reconcile';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import {
  showErrorToast,
  showProgressToast,
  showSuccessToast,
} from '@/components/ui/Toast/toast-manager';
import { RECONCILE_ERROR_TITLE, RECONCILE_OUTCOME_TITLE } from '../constants/reconcile-toasts';

vi.mock('@/api/onboardings/onboarding-reconcile', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/onboarding-reconcile')>();

  return {
    ...actual,
    reconcilePendingConnector: vi.fn(),
  };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
  showProgressToast: vi.fn(),
}));

const mockedReconcile = vi.mocked(reconcilePendingConnector);
const mockedShowSuccessToast = vi.mocked(showSuccessToast);
const mockedShowErrorToast = vi.mocked(showErrorToast);
const mockedShowProgressToast = vi.mocked(showProgressToast);

const ONBOARDING_ID = 'onboarding-1';

const PARKED_SUMMARY: AdminOnboardingSummary = {
  onboardingId: ONBOARDING_ID,
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'identity',
  expiresAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  completedAt: null,
  scores: {},
  pendingConnector: {
    connectorId: 'veriff_kyc',
    connectorName: 'Veriff',
    connectorOrder: 0,
    parkedAt: '2026-07-01T00:00:00.000Z',
  },
};

const APPROVED_SUMMARY: AdminOnboardingSummary = {
  ...PARKED_SUMMARY,
  status: 'approved',
  currentStep: null,
  completedAt: '2026-07-02T00:00:00.000Z',
  pendingConnector: null,
};

/** The client the most recent render supplied, so a settled mutation's cache writes are observable. */
let lastQueryClient: ReturnType<typeof createQueryClient>;

/** The app's own client, so the factory's meta invalidations run as they do in the panel. */
function createWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = createQueryClient();
  lastQueryClient = client;

  return ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

const INACTIVE_LIST_KEY = [...onboardingQueries.lists(), 'seeded'];
const INACTIVE_AUDIT_KEY = [...auditQueries.lists(), 'seeded'];
const DETAIL_KEY = onboardingQueries.detail(ONBOARDING_ID).queryKey;
const TRANSITIONS_KEY = onboardingQueries.transitions(ONBOARDING_ID).queryKey;

/** The cached page as the operator sees it, plus pages no component observes any more. */
function seedCache(): void {
  lastQueryClient.setQueryData(DETAIL_KEY, PARKED_SUMMARY);
  lastQueryClient.setQueryData(TRANSITIONS_KEY, { transitions: [], truncated: false });
  lastQueryClient.setQueryData(INACTIVE_LIST_KEY, {});
  lastQueryClient.setQueryData(INACTIVE_AUDIT_KEY, {});
}

beforeEach(() => {
  mockedReconcile.mockReset();
  mockedShowSuccessToast.mockReset();
  mockedShowErrorToast.mockReset();
  mockedShowProgressToast.mockReset();
});

describe('useOnboardingReconcile', () => {
  it('reports the check in flight until the request settles', async () => {
    let resolveReconcile: (value: OnboardingReconcileResult) => void = () => {};
    mockedReconcile.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveReconcile = resolve;
      }),
    );
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(result.current.isPending).toBe(true);
    });
    expect(mockedReconcile).toHaveBeenCalledWith(ONBOARDING_ID);

    resolveReconcile({ outcome: 'applied', onboarding: APPROVED_SUMMARY });
    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
  });

  it('writes the answered summary into the detail query and invalidates the trail, the list and the audit log once a verdict is applied', async () => {
    mockedReconcile.mockResolvedValueOnce({ outcome: 'applied', onboarding: APPROVED_SUMMARY });
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });
    seedCache();
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(lastQueryClient.getQueryData(DETAIL_KEY)).toEqual(APPROVED_SUMMARY);
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: TRANSITIONS_KEY });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: onboardingQueries.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: auditQueries.all() });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    expect(lastQueryClient.getQueryState(TRANSITIONS_KEY)?.isInvalidated).toBe(true);
    expect(lastQueryClient.getQueryState(INACTIVE_LIST_KEY)?.isInvalidated).toBe(true);
    expect(lastQueryClient.getQueryState(INACTIVE_AUDIT_KEY)?.isInvalidated).toBe(true);
    expect(mockedShowSuccessToast).toHaveBeenCalledWith(RECONCILE_OUTCOME_TITLE.applied);
  });

  it('raises a progress toast while the provider is still deciding, keeping the park on screen', async () => {
    mockedReconcile.mockResolvedValueOnce({
      outcome: 'still_pending',
      onboarding: PARKED_SUMMARY,
    });
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });
    seedCache();

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(mockedShowProgressToast).toHaveBeenCalledWith(RECONCILE_OUTCOME_TITLE.still_pending);
    });
    expect(lastQueryClient.getQueryData(DETAIL_KEY)).toEqual(PARKED_SUMMARY);
    expect(mockedShowSuccessToast).not.toHaveBeenCalled();
  });

  it('raises a success toast saying the onboarding moved on when the park was superseded', async () => {
    mockedReconcile.mockResolvedValueOnce({
      outcome: 'superseded',
      onboarding: APPROVED_SUMMARY,
    });
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });
    seedCache();

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(mockedShowSuccessToast).toHaveBeenCalledWith(RECONCILE_OUTCOME_TITLE.superseded);
    });
    expect(lastQueryClient.getQueryData(DETAIL_KEY)).toEqual(APPROVED_SUMMARY);
  });

  it('raises the error toast with the failure message when the check fails', async () => {
    const error = new ApiError('Unavailable', { status: HttpStatusCode.ServiceUnavailable });
    mockedReconcile.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });
    seedCache();
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(mockedShowErrorToast).toHaveBeenCalledWith(RECONCILE_ERROR_TITLE, error.message);
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(lastQueryClient.getQueryData(DETAIL_KEY)).toEqual(PARKED_SUMMARY);
  });

  // A 409 means the onboarding is no longer parked, or not parked the way the page shows it, so
  // the operator is most likely looking at stale state.
  it('invalidates the summary, the list and the audit log after a check refused with a 409', async () => {
    mockedReconcile.mockRejectedValueOnce(
      new ApiError('Conflict', { status: HttpStatusCode.Conflict }),
    );
    const { result } = renderHook(() => useOnboardingReconcile(ONBOARDING_ID), {
      wrapper: createWrapper(),
    });
    seedCache();
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');

    act(() => {
      result.current.reconcile();
    });

    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: DETAIL_KEY });
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: onboardingQueries.lists() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: auditQueries.all() });
    expect(lastQueryClient.getQueryState(INACTIVE_LIST_KEY)?.isInvalidated).toBe(true);
    expect(lastQueryClient.getQueryState(INACTIVE_AUDIT_KEY)?.isInvalidated).toBe(true);
    expect(mockedShowErrorToast).toHaveBeenCalledWith(RECONCILE_ERROR_TITLE, 'Conflict');
  });
});
