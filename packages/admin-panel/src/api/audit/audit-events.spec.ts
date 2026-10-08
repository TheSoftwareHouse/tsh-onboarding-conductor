import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { ADMIN_AUDIT_ENDPOINT } from './audit-events';
import { fetchAuditEvents, type AuditEvent, type AuditEventQueryFilters } from './audit-events';

const { mockedGet } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  return { mockedGet };
});

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const DEFAULT_QUERY_FILTERS: AuditEventQueryFilters = {
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

const VALID_EVENT: AuditEvent = {
  id: '018f1e2a-1111-7000-8000-000000000001',
  occurredAt: '2026-07-01T00:00:00.000Z',
  actorType: 'system',
  actorId: 'engine',
  action: 'onboarding.started',
  resourceType: 'onboarding',
  resourceId: '018f1e2a-2222-7000-8000-000000000002',
  metadata: { workflowId: 'kyc-basic' },
};

const VALID_PAGINATION = { page: 1, limit: 20, total: 1, totalPages: 1 };

function auditResponse(items: unknown[], pagination = VALID_PAGINATION): { data: unknown } {
  return { data: { items, meta: { pagination } } };
}

async function expectFetchError(
  promise: Promise<unknown>,
  reason: string,
  message?: string,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(ApiError);
    const typedError = error as ApiError;
    expect(typedError.kind).toBe(reason);
    if (message !== undefined) {
      expect(typedError.message).toBe(message);
    }
  }
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAuditEvents', () => {
  it('requests the admin audit path with the given query filters against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(auditResponse([VALID_EVENT]));

    const filters: AuditEventQueryFilters = {
      ...DEFAULT_QUERY_FILTERS,
      page: 2,
      limit: 50,
      actorType: 'operator',
      action: 'auth.access_granted',
    };
    await fetchAuditEvents(filters);

    // `occurredPeriod` never reaches the wire under its own key - it is resolved into
    // `occurredFrom` (or dropped) by `toRequestParams`. Every other absent criterion stays `null`,
    // which axios drops on its own.
    expect(mockedGet).toHaveBeenCalledWith(ADMIN_AUDIT_ENDPOINT, {
      params: { ...filters, occurredPeriod: undefined },
    });
  });

  it('resolves a relative period into an instant the endpoint accepts', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    mockedGet.mockResolvedValueOnce(auditResponse([VALID_EVENT]));

    await fetchAuditEvents({ ...DEFAULT_QUERY_FILTERS, occurredPeriod: '24h' });

    // The period never reaches the wire - `ListAuditQueryDto` does not accept one.
    expect(mockedGet).toHaveBeenCalledWith(ADMIN_AUDIT_ENDPOINT, {
      params: {
        ...DEFAULT_QUERY_FILTERS,
        occurredPeriod: undefined,
        occurredFrom: '2026-09-10T12:00:00.000Z',
      },
    });

    vi.useRealTimers();
  });

  it('resolves the same period afresh per request, so the window keeps ending at now', async () => {
    vi.useFakeTimers();
    const filters: AuditEventQueryFilters = { ...DEFAULT_QUERY_FILTERS, occurredPeriod: '1h' };

    vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'));
    mockedGet.mockResolvedValueOnce(auditResponse([VALID_EVENT]));
    await fetchAuditEvents(filters);

    vi.setSystemTime(new Date('2026-09-11T18:00:00.000Z'));
    mockedGet.mockResolvedValueOnce(auditResponse([VALID_EVENT]));
    await fetchAuditEvents(filters);

    // Same committed criterion, six hours apart, two different windows. Committing the instant
    // instead would have pinned both requests to the hour before the criterion was first applied.
    expect(mockedGet.mock.calls[0]?.[1].params.occurredFrom).toBe('2026-09-11T11:00:00.000Z');
    expect(mockedGet.mock.calls[1]?.[1].params.occurredFrom).toBe('2026-09-11T17:00:00.000Z');

    vi.useRealTimers();
  });

  it('returns the events together with the page window the endpoint reported', async () => {
    const pagination = { page: 2, limit: 20, total: 41, totalPages: 3 };
    mockedGet.mockResolvedValueOnce(auditResponse([VALID_EVENT], pagination));

    await expect(fetchAuditEvents(DEFAULT_QUERY_FILTERS)).resolves.toEqual({
      events: [VALID_EVENT],
      pagination,
    });
  });

  it('keeps an event whose actor, action or resource type this build does not know', async () => {
    const unknownEvent = { ...VALID_EVENT, actorType: 'scheduler', resourceType: 'reminder' };
    mockedGet.mockResolvedValueOnce(auditResponse([unknownEvent]));

    const result = await fetchAuditEvents(DEFAULT_QUERY_FILTERS);

    expect(result.events).toEqual([unknownEvent]);
  });

  it('drops fields the endpoint may add beyond the ones the table renders', async () => {
    mockedGet.mockResolvedValueOnce(auditResponse([{ ...VALID_EVENT, hashSelf: 'abc' }]));

    const result = await fetchAuditEvents(DEFAULT_QUERY_FILTERS);

    expect(result.events).toEqual([VALID_EVENT]);
  });

  it('reports a malformed event rather than rendering a partial trail', async () => {
    mockedGet.mockResolvedValueOnce(auditResponse([{ ...VALID_EVENT, action: '' }]));

    await expectFetchError(
      fetchAuditEvents(DEFAULT_QUERY_FILTERS),
      'invalid-payload',
      'Response contains a malformed audit event.',
    );
  });

  it('reports a missing pagination envelope as a malformed payload', async () => {
    mockedGet.mockResolvedValueOnce({ data: { items: [VALID_EVENT] } });

    await expectFetchError(fetchAuditEvents(DEFAULT_QUERY_FILTERS), 'invalid-payload');
  });

  it.each([
    [401, 'Your session is no longer accepted by the engine. Sign in again.'],
    [403, 'Your account is signed in but is not assigned a role that may view the audit log.'],
    [
      503,
      'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
    ],
    [500, 'Request failed with status 500.'],
  ])('explains a %s response in terms the operator can act on', async (status, message) => {
    const axiosError = new AxiosError(`Request failed with status code ${status}`);
    axiosError.response = { status } as AxiosError['response'];
    mockedGet.mockRejectedValueOnce(axiosError);

    await expectFetchError(fetchAuditEvents(DEFAULT_QUERY_FILTERS), 'request-failed', message);
  });

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expectFetchError(
      fetchAuditEvents(DEFAULT_QUERY_FILTERS),
      'request-failed',
      'Network Error',
    );
  });
});
