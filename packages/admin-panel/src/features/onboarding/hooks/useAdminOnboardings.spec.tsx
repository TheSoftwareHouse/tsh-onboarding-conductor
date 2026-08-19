import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { useAdminOnboardings } from './useAdminOnboardings';
import { fetchAdminOnboardings, type AdminOnboardingsPage } from '../api/admin-onboardings';
import { createDefaultAdminOnboardingFilters } from '../utils/admin-onboardings-query';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';

vi.mock('../api/admin-onboardings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-onboardings')>();

  return {
    ...actual,
    fetchAdminOnboardings: vi.fn(),
  };
});

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);

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

function page(
  records: AdminOnboardingSummary[],
  overrides: Partial<AdminOnboardingsPage['pagination']> = {},
): AdminOnboardingsPage {
  return {
    records,
    pagination: {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      total: records.length,
      totalPages: records.length > 0 ? 1 : 0,
      ...overrides,
    },
  };
}

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

describe('useAdminOnboardings', () => {
  it('explicitly refetches when Apply commits filters identical to the currently applied ones', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);

    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([]));
    act(() => {
      result.current.applyFilters(result.current.appliedFilters);
    });

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
  });

  it('explicitly refetches when Reset commits filters identical to the currently applied ones', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);

    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([]));
    act(() => {
      result.current.resetFilters();
    });

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
  });

  it('ignores Apply and Reset while the initial request is still pending', () => {
    mockedFetchAdminOnboardings.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('loading');

    act(() => {
      result.current.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
      result.current.resetFilters();
    });

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(result.current.appliedFilters.workflowId).toBe('');
  });

  it('hides cached rows and reports phase loading while a same-key Apply refetch is in flight', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.records).toEqual([RECORD_ONE]);

    let resolveRefetch: (value: AdminOnboardingsPage) => void = () => {};
    mockedFetchAdminOnboardings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
    );

    act(() => {
      result.current.applyFilters(result.current.appliedFilters);
    });

    await waitFor(() => {
      expect(result.current.phase).toBe('loading');
    });
    expect(result.current.records).toEqual([]);

    resolveRefetch(page([]));

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.records).toEqual([]);
  });

  it('reports the page window from the last successful fetch', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_ONE], { page: 2, total: 41, totalPages: 3 }),
    );
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    expect(result.current.pagination).toEqual({
      page: 2,
      limit: DEFAULT_PAGE_SIZE,
      total: 41,
      totalPages: 3,
    });
  });

  it('fetches the requested page when the operator moves through the pager', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_ONE], { total: 41, totalPages: 3 }),
    );
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_ONE], { page: 2, total: 41, totalPages: 3 }),
    );
    act(() => {
      result.current.goToPage(2);
    });

    await waitFor(() => {
      expect(result.current.appliedPage).toBe(2);
    });
    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it('returns the operator to the first page when new criteria are applied', async () => {
    mockedFetchAdminOnboardings.mockResolvedValue(page([RECORD_ONE], { total: 41, totalPages: 3 }));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    act(() => {
      result.current.goToPage(3);
    });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.appliedPage).toBe(3);

    act(() => {
      result.current.applyFilters({
        ...createDefaultAdminOnboardingFilters(),
        workflowId: 'kyc-basic',
      });
    });

    await waitFor(() => {
      expect(result.current.appliedPage).toBe(1);
    });
  });

  it('ignores a page change while a request is still in flight', () => {
    mockedFetchAdminOnboardings.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAdminOnboardings(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('loading');

    act(() => {
      result.current.goToPage(2);
    });

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(result.current.appliedPage).toBe(1);
  });
});
