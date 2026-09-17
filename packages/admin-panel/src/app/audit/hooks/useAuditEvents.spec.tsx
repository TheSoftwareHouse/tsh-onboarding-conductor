import type { ReactElement, ReactNode } from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import { fetchAuditEvents } from '../api/admin-audit-events';
import { DEFAULT_AUDIT_EVENT_FILTERS } from '../utils/audit-events-query';
import { useAuditEvents } from './useAuditEvents';

vi.mock('../api/admin-audit-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/admin-audit-events')>()),
  fetchAuditEvents: vi.fn(),
}));

const mockedFetchAuditEvents = vi.mocked(fetchAuditEvents);

/** The query filters an all-absent state maps to - every criterion `null`. */
const DEFAULT_WINDOW = {
  page: 1,
  limit: DEFAULT_PAGE_SIZE,
  actorType: null,
  actorId: null,
  action: null,
  resourceType: null,
  resourceId: null,
  occurredPeriod: null,
  occurredFrom: null,
  occurredTo: null,
};

/** The client the most recent render supplied, so a commit's invalidation is observable. */
let lastQueryClient: QueryClient;

function renderAuditEvents(
  initialPath = '/audit',
): ReturnType<typeof renderHook<ReturnType<typeof useAuditEvents>, never>> {
  // `BrowserRouter` reads and writes the same `window.history` the nuqs react-router adapter
  // does, matching production - so seeding is a single write before render.
  window.history.replaceState(null, '', initialPath);

  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastQueryClient = queryClient;

  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <NuqsAdapter>{children}</NuqsAdapter>
      </BrowserRouter>
    </QueryClientProvider>
  );

  return renderHook(() => useAuditEvents(), { wrapper });
}

beforeEach(() => {
  mockedFetchAuditEvents.mockResolvedValue({
    events: [],
    pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/audit');
});

describe('useAuditEvents', () => {
  it('commits criteria to the URL, leaving the default page window out of it', async () => {
    const { result } = renderAuditEvents();
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    act(() => {
      result.current.applyFilters({ ...DEFAULT_AUDIT_EVENT_FILTERS, action: 'onboarding.started' });
    });

    await waitFor(() => {
      expect(window.location.search).toBe('?action=onboarding.started');
    });
  });

  it('invalidates the committed key, so re-applying identical criteria still refetches', async () => {
    const { result } = renderAuditEvents();
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    const filters = { ...DEFAULT_AUDIT_EVENT_FILTERS, action: 'onboarding.started' };
    act(() => {
      result.current.applyFilters(filters);
    });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    const invalidate = vi.spyOn(lastQueryClient, 'invalidateQueries');
    act(() => {
      result.current.applyFilters({ ...filters });
    });

    // Apply is an explicit action: a key that did not change would not refetch on its own, so
    // the commit invalidates it rather than comparing keys to decide.
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['admin-audit-events', { ...DEFAULT_WINDOW, action: 'onboarding.started' }],
    });
  });

  it('ignores a commit while a fetch is already in flight', async () => {
    const { result } = renderAuditEvents();
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    let release: (() => void) | undefined;
    mockedFetchAuditEvents.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = (): void =>
            resolve({
              events: [],
              pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
            });
        }),
    );

    act(() => {
      result.current.applyFilters({ ...DEFAULT_AUDIT_EVENT_FILTERS, action: 'first' });
    });
    await waitFor(() => expect(result.current.phase).toBe('loading'));

    await act(async () => {
      result.current.applyFilters({ ...DEFAULT_AUDIT_EVENT_FILTERS, action: 'second' });
      // Long enough for the commit to have reached the URL had the guard not refused it.
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(window.location.search).toBe('?action=first');
    act(() => release?.());
  });
});
