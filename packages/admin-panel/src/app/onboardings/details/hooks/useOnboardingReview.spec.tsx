import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { HttpStatusCode } from 'axios';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useOnboardingReview } from './useOnboardingReview';
import { OnboardingReviewError, submitOnboardingReview } from '@/api/onboardings/onboarding-review';
import { auditQueries } from '@/api/audit/audit-queries';
import { onboardingQueries } from '@/api/onboardings/onboarding-queries';

vi.mock('@/api/onboardings/onboarding-review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/onboarding-review')>();

  return {
    ...actual,
    submitOnboardingReview: vi.fn(),
  };
});

const mockedSubmitOnboardingReview = vi.mocked(submitOnboardingReview);

/** The client the most recent render supplied, so a settled mutation's invalidation is observable. */
let lastQueryClient: QueryClient;

function createWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      // Matches QueryProvider.tsx's remount rule, which is what re-reads an invalidated page.
      queries: { retry: false, refetchOnMount: (query) => query.state.isInvalidated },
      mutations: { retry: false },
    },
  });
  lastQueryClient = client;

  return ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

/** A wrapper over the client the review hook already used, so a later mount shares its cache. */
function reuseLastClient({ children }: { children: ReactNode }): ReactElement {
  return <QueryClientProvider client={lastQueryClient}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockedSubmitOnboardingReview.mockReset();
});

const INACTIVE_LIST_KEY = [...onboardingQueries.lists(), 'seeded'];
const INACTIVE_AUDIT_KEY = [...auditQueries.lists(), 'seeded'];

/** Cached pages no component observes, as the list and Logs pages leave behind once left. */
function seedInactivePages(): void {
  lastQueryClient.setQueryData(INACTIVE_LIST_KEY, {});
  lastQueryClient.setQueryData(INACTIVE_AUDIT_KEY, {});
}

function expectDecisionInvalidated(invalidate: ReturnType<typeof vi.spyOn>): void {
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: onboardingQueries.detail('onboarding-1').queryKey,
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: onboardingQueries.lists() });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: auditQueries.all() });
  expect(lastQueryClient.getQueryState(INACTIVE_LIST_KEY)?.isInvalidated).toBe(true);
  expect(lastQueryClient.getQueryState(INACTIVE_AUDIT_KEY)?.isInvalidated).toBe(true);
}

describe('useOnboardingReview', () => {
  it('tracks the action in flight and clears it once the request settles', async () => {
    let resolveSubmit: (value: { status: string; currentStep: string | null }) => void = () => {};
    mockedSubmitOnboardingReview.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSubmit = resolve;
      }),
    );
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.submit('approve');
    });

    expect(result.current.pendingAction).toBe('approve');
    await waitFor(() => {
      expect(mockedSubmitOnboardingReview).toHaveBeenCalledWith('onboarding-1', 'approve');
    });

    resolveSubmit({ status: 'approved', currentStep: null });
    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });
  });

  it('invalidates the onboarding summary (and its nested transitions), the list, and the audit trail, including their inactive pages, once a decision is recorded', async () => {
    mockedSubmitOnboardingReview.mockResolvedValueOnce({
      status: 'approved',
      currentStep: null,
    });
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');
    seedInactivePages();

    act(() => {
      result.current.submit('approve');
    });

    await waitFor(() => {
      expectDecisionInvalidated(invalidate);
    });
  });

  it('reports a failed decision as its error', async () => {
    const error = new OnboardingReviewError('Conflict', HttpStatusCode.Conflict);
    mockedSubmitOnboardingReview.mockRejectedValueOnce(error);
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.submit('reject');
    });

    await waitFor(() => {
      expect(result.current.error).toBe(error);
    });
  });

  it('clears its error on resetError', async () => {
    mockedSubmitOnboardingReview.mockRejectedValueOnce(
      new OnboardingReviewError('Unavailable', HttpStatusCode.ServiceUnavailable),
    );
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });

    act(() => {
      result.current.submit('approve');
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => {
      result.current.resetError();
    });

    await waitFor(() => expect(result.current.error).toBeNull());
  });

  // A 409 means the onboarding has already moved past the step the decision named, so that
  // failure is the case where the operator is most likely looking at stale state.
  it('invalidates just the same after a decision refused with a 409', async () => {
    mockedSubmitOnboardingReview.mockRejectedValueOnce(
      new OnboardingReviewError('Conflict', HttpStatusCode.Conflict),
    );
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');
    seedInactivePages();

    act(() => {
      result.current.submit('reject');
    });

    await waitFor(() => {
      expectDecisionInvalidated(invalidate);
    });
  });

  it('does not invalidate anything after a decision that fails without a 409', async () => {
    mockedSubmitOnboardingReview.mockRejectedValueOnce(
      new OnboardingReviewError('Unavailable', HttpStatusCode.ServiceUnavailable),
    );
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });
    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');
    seedInactivePages();

    act(() => {
      result.current.submit('reject');
    });

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(invalidate).not.toHaveBeenCalled();
    expect(lastQueryClient.getQueryState(INACTIVE_LIST_KEY)?.isInvalidated).toBe(false);
    expect(lastQueryClient.getQueryState(INACTIVE_AUDIT_KEY)?.isInvalidated).toBe(false);
  });

  it('keeps a cached list page after a decision and re-reads it once the page mounts again', async () => {
    mockedSubmitOnboardingReview.mockResolvedValueOnce({ status: 'approved', currentStep: null });
    const { result } = renderHook(() => useOnboardingReview('onboarding-1'), {
      wrapper: createWrapper(),
    });
    seedInactivePages();

    act(() => {
      result.current.submit('approve');
    });
    await waitFor(() => {
      expect(lastQueryClient.getQueryState(INACTIVE_LIST_KEY)?.isInvalidated).toBe(true);
    });
    expect(lastQueryClient.getQueryData(INACTIVE_LIST_KEY)).toBeDefined();

    const readListPage = vi.fn().mockResolvedValue({});
    renderHook(() => useQuery({ queryKey: INACTIVE_LIST_KEY, queryFn: readListPage }), {
      wrapper: reuseLastClient,
    });

    await waitFor(() => {
      expect(readListPage).toHaveBeenCalledTimes(1);
    });
  });
});
