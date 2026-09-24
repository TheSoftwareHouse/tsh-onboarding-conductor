import type { ReactElement, ReactNode } from 'react';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchAuditEvents, type AuditEvent } from '@/api/audit/audit-events';
import { DEFAULT_PAGE } from '@/lib/pagination';
import { useOnboardingActivity } from './useOnboardingActivity';

vi.mock('@/api/audit/audit-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/audit/audit-events')>()),
  fetchAuditEvents: vi.fn(),
}));

const mockedFetchAuditEvents = vi.mocked(fetchAuditEvents);
const ONBOARDING_ID = '018f1e2a-1111-7000-8000-000000000001';
const ACTIVITY_LOG_ENTRY_LIMIT = 6;

/** Every criterion but the resource and the limit, absent — matching the audit page's own shape. */
const EXPECTED_FILTERS = {
  page: DEFAULT_PAGE,
  limit: ACTIVITY_LOG_ENTRY_LIMIT,
  actorType: null,
  actorId: null,
  action: null,
  resourceType: 'onboarding',
  resourceId: ONBOARDING_ID,
  occurredPeriod: null,
  occurredFrom: null,
  occurredTo: null,
};

function auditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    id: 'row-1',
    occurredAt: '2026-07-01T10:00:00.000Z',
    actorType: 'system',
    actorId: 'engine',
    action: 'onboarding.started',
    resourceType: 'onboarding',
    resourceId: ONBOARDING_ID,
    metadata: {},
    ...overrides,
  };
}

function renderActivity(): ReturnType<
  typeof renderHook<ReturnType<typeof useOnboardingActivity>, never>
> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );

  return renderHook(() => useOnboardingActivity(ONBOARDING_ID), { wrapper });
}

beforeEach(() => {
  mockedFetchAuditEvents.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useOnboardingActivity', () => {
  it('reads the fixed number of most recent entries for the given onboarding, with every other criterion absent', async () => {
    mockedFetchAuditEvents.mockResolvedValue({
      events: [],
      pagination: { page: 1, limit: ACTIVITY_LOG_ENTRY_LIMIT, total: 0, totalPages: 0 },
    });

    const { result } = renderActivity();
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(mockedFetchAuditEvents).toHaveBeenCalledWith(EXPECTED_FILTERS);
  });

  it('reports the entries and the reported total once the read settles', async () => {
    const event = auditEvent();
    mockedFetchAuditEvents.mockResolvedValue({
      events: [event],
      pagination: { page: 1, limit: ACTIVITY_LOG_ENTRY_LIMIT, total: 12, totalPages: 2 },
    });

    const { result } = renderActivity();
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    expect(result.current.entries).toEqual([
      {
        id: event.id,
        occurredAt: event.occurredAt,
        action: event.action,
        metadata: event.metadata,
      },
    ]);
    expect(result.current.total).toBe(12);
  });

  it('reports the failure message rather than a partial list, while a fetch is in flight', async () => {
    mockedFetchAuditEvents.mockReturnValue(new Promise(() => {}));

    const { result } = renderActivity();

    expect(result.current.phase).toBe('loading');
    expect(result.current.entries).toEqual([]);
  });

  it('reports a refusal as an error phase with no entries', async () => {
    mockedFetchAuditEvents.mockRejectedValue(new Error('Request failed with status 403.'));

    const { result } = renderActivity();
    await waitFor(() => expect(result.current.phase).toBe('error'));

    expect(result.current.entries).toEqual([]);
    expect(result.current.error).toBe('Request failed with status 403.');
  });
});
