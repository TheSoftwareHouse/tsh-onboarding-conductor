import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditQueries } from './audit-queries';
import {
  fetchAuditEvents,
  type AuditEventQueryFilters,
  type AuditEventsPage,
} from './audit-events';

vi.mock('./audit-events', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audit-events')>()),
  fetchAuditEvents: vi.fn(),
}));

const mockedFetchAuditEvents = vi.mocked(fetchAuditEvents);

const FILTERS: AuditEventQueryFilters = {
  page: 1,
  limit: 20,
  actorType: null,
  actorId: null,
  action: null,
  resourceType: null,
  resourceId: null,
  occurredPeriod: null,
  occurredFrom: null,
  occurredTo: null,
};

const PAGE: AuditEventsPage = {
  events: [],
  pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
};

beforeEach(() => {
  mockedFetchAuditEvents.mockReset();
  mockedFetchAuditEvents.mockResolvedValue(PAGE);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('auditQueries', () => {
  it('builds the key hierarchy exactly as pinned', () => {
    expect(auditQueries.all()).toEqual(['audit']);
    expect(auditQueries.lists()).toEqual(['audit', 'list']);
    expect(auditQueries.list(FILTERS).queryKey).toEqual(['audit', 'list', FILTERS]);
  });

  it('fetches with the same filters the key was built from, across the module boundary', async () => {
    const options = auditQueries.list(FILTERS);

    await options.queryFn?.({
      queryKey: options.queryKey,
      signal: new AbortController().signal,
      meta: undefined,
      client: undefined as never,
    });

    expect(mockedFetchAuditEvents).toHaveBeenCalledWith(FILTERS);
  });
});
