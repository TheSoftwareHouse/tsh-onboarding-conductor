import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAdminOnboardingsQuery } from './useAdminOnboardingsQuery';
import { buildAdminOnboardingsQueryKey } from '../utils/admin-onboardings-query';
import { fetchAdminOnboardings } from '../api/admin-onboardings';
import { AdminOnboardingsFetchError } from '../api/admin-onboardings';
import type { AdminOnboardingFilters } from '../utils/filter-admin-onboardings';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';

vi.mock('../api/admin-onboardings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-onboardings')>();

  return {
    ...actual,
    fetchAdminOnboardings: vi.fn(),
  };
});

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);

const DEFAULT_FILTERS: AdminOnboardingFilters = {
  status: '',
  workflowId: '',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
};

const RECORD_ONE: AdminOnboardingSummary = {
  onboardingId: '018f1e2a-1111-7000-8000-000000000001',
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'collect-documents',
  expiresAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  completedAt: null,
};

function createWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });

  return ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockedFetchAdminOnboardings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useAdminOnboardingsQuery', () => {
  it('is pending with no data before the request settles', () => {
    mockedFetchAdminOnboardings.mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    expect(result.current.isPending).toBe(true);
    expect(result.current.isFetching).toBe(true);
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(false);
  });

  it('exposes the resolved data once the request succeeds', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isPending).toBe(false);
    });
    expect(result.current.data).toEqual([RECORD_ONE]);
    expect(result.current.isError).toBe(false);
  });

  it('exposes the typed fetch error once the request rejects', async () => {
    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('request-failed', 'Failed to fetch'),
    );

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.reason).toBe('request-failed');
  });

  it('does not retry a failed request given the app-wide retry:false default', async () => {
    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('request-failed', 'Request failed with status 500.', 500),
    );

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });

  it('refetches on demand via the exposed refetch function', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([RECORD_ONE]);
    });

    mockedFetchAdminOnboardings.mockResolvedValueOnce([]);
    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.data).toEqual([]);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
  });

  it('reports isFetching while a same-key refetch is in flight despite cached data', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);

    const { result } = renderHook(
      () =>
        useAdminOnboardingsQuery({
          queryKey: buildAdminOnboardingsQueryKey(DEFAULT_FILTERS),
        }),
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.data).toEqual([RECORD_ONE]);
    });
    expect(result.current.isFetching).toBe(false);

    let resolveRefetch: (value: AdminOnboardingSummary[]) => void = () => {};
    mockedFetchAdminOnboardings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
    );

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.isFetching).toBe(true);
    });
    expect(result.current.isPending).toBe(false);
    expect(result.current.data).toEqual([RECORD_ONE]);

    resolveRefetch([]);

    await waitFor(() => {
      expect(result.current.isFetching).toBe(false);
    });
  });
});
