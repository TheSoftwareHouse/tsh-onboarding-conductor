import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { AdminOnboardingsFetchError, fetchAdminOnboardings } from './admin-onboardings';
import { ONBOARDING_ENDPOINTS } from '../constants/endpoints';
import { WORKFLOW_VERSION_ERROR_MESSAGE } from '../utils/filter-admin-onboardings';
import { ADMIN_ONBOARDING_STATUSES, type AdminOnboardingSummary } from '../types/admin-onboarding';

const { mockedGet } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  return { mockedGet };
});

vi.mock('@/shared/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

async function expectFetchError(
  promise: Promise<unknown>,
  reason: string,
  message?: string,
): Promise<void> {
  try {
    await promise;
    throw new Error('Expected promise to reject');
  } catch (error) {
    expect(error).toBeInstanceOf(AdminOnboardingsFetchError);
    const typedError = error as AdminOnboardingsFetchError;
    expect(typedError.reason).toBe(reason);
    if (message !== undefined) {
      expect(typedError.message).toBe(message);
    }
  }
}

const VALID_RECORD: AdminOnboardingSummary = {
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

/** The window the endpoint reports for a default, unfiltered first page. */
const FIRST_PAGE_WINDOW = { page: 1, limit: 20, total: 1, totalPages: 1 };

/** The params every request carries now that the endpoint is paginated. */
const DEFAULT_PAGE_PARAMS = { page: 1, limit: DEFAULT_PAGE_SIZE };

function paginatedBody(
  items: unknown[],
  pagination: Record<string, number> = { ...FIRST_PAGE_WINDOW, total: items.length },
) {
  return { items, meta: { pagination } };
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function axiosResponse<T>(data: T): { data: T } {
  return { data };
}

function createBlankFilters() {
  return {
    status: '' as const,
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
    limit: DEFAULT_PAGE_SIZE,
  };
}

describe('fetchAdminOnboardings', () => {
  it('accepts every status the engine emits', async () => {
    // A narrower enum here rejected the whole page as a malformed payload the moment an
    // onboarding reached a terminal or manual-review status.
    const records = ADMIN_ONBOARDING_STATUSES.map((status, index) => ({
      ...VALID_RECORD,
      onboardingId: `018f1e2a-1111-7000-8000-00000000000${index}`,
      status,
    }));
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody(records)));

    const { records: returned } = await fetchAdminOnboardings();

    expect(returned).toEqual(records);
  });

  it('accepts a future non-empty status without rejecting the page', async () => {
    const record = { ...VALID_RECORD, status: 'awaiting_provider_callback' };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([record])));

    const { records } = await fetchAdminOnboardings();

    expect(records).toEqual([record]);
  });

  it('requests the admin onboarding path with normalized params against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));

    await expect(fetchAdminOnboardings()).resolves.toEqual({
      records: [],
      pagination: { ...FIRST_PAGE_WINDOW, total: 0 },
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(ONBOARDING_ENDPOINTS.adminOnboardings, {
      params: DEFAULT_PAGE_PARAMS,
    });
  });

  it('asks for the requested page rather than always the first one', async () => {
    mockedGet.mockResolvedValueOnce(
      axiosResponse(paginatedBody([], { page: 3, limit: 50, total: 120, totalPages: 3 })),
    );

    const page = await fetchAdminOnboardings({
      filters: { ...createBlankFilters(), limit: 50 },
      page: 3,
    });

    expect(mockedGet).toHaveBeenCalledWith(ONBOARDING_ENDPOINTS.adminOnboardings, {
      params: { page: 3, limit: 50 },
    });
    expect(page.pagination).toEqual({ page: 3, limit: 50, total: 120, totalPages: 3 });
  });

  it('omits every blank filter, leaving only the page window', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));

    await fetchAdminOnboardings({
      filters: {
        status: '',
        workflowId: '   ',
        workflowVersion: '   ',
        currentStep: ' ',
        onboardingId: '\t',
        limit: DEFAULT_PAGE_SIZE,
      },
    });

    expect(mockedGet).toHaveBeenCalledWith(ONBOARDING_ENDPOINTS.adminOnboardings, {
      params: DEFAULT_PAGE_PARAMS,
    });
  });

  it('normalizes each of the five supported filters into request params', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));

    await fetchAdminOnboardings({
      filters: {
        status: 'approved',
        workflowId: '  kyc-basic  ',
        workflowVersion: '  7 ',
        currentStep: ' collect-documents ',
        onboardingId: '  018f1e2a-1111-7000-8000-000000000001  ',
        limit: DEFAULT_PAGE_SIZE,
      },
    });

    expect(mockedGet).toHaveBeenCalledWith(ONBOARDING_ENDPOINTS.adminOnboardings, {
      params: {
        ...DEFAULT_PAGE_PARAMS,
        status: 'approved',
        workflowId: 'kyc-basic',
        workflowVersion: '7',
        currentStep: 'collect-documents',
        onboardingId: '018f1e2a-1111-7000-8000-000000000001',
      },
    });
  });

  it('rejects with an invalid-input error and never calls axios for a non-empty invalid workflowVersion', async () => {
    const cases = ['0', '-1', '+1', '1.2', '1e3', 'abc'];
    for (const workflowVersion of cases) {
      await expectFetchError(
        fetchAdminOnboardings({
          filters: {
            status: '',
            workflowId: '',
            workflowVersion,
            currentStep: '',
            onboardingId: '',
            limit: DEFAULT_PAGE_SIZE,
          },
        }),
        'invalid-input',
        WORKFLOW_VERSION_ERROR_MESSAGE,
      );
    }

    expect(mockedGet).not.toHaveBeenCalled();
  });

  it('projects records onto the nine lifecycle-safe fields and excludes context', async () => {
    const rawRecord = { ...VALID_RECORD, context: { secret: 'do-not-render' } };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([rawRecord])));

    await expect(fetchAdminOnboardings()).resolves.toEqual({
      records: [VALID_RECORD],
      pagination: FIRST_PAGE_WINDOW,
    });
  });

  it('drops unexpected extra fields while preserving the lifecycle-safe projection', async () => {
    const rawRecord = {
      ...VALID_RECORD,
      context: { secret: 'do-not-render' },
      unexpected: true,
    };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([rawRecord])));

    await expect(fetchAdminOnboardings()).resolves.toEqual({
      records: [VALID_RECORD],
      pagination: FIRST_PAGE_WINDOW,
    });
  });

  it('rejects with a request-failed error carrying the response status for a non-2xx response', async () => {
    const axiosError = new AxiosError('Request failed with status code 500');
    axiosError.response = {
      status: 500,
      statusText: 'Internal Server Error',
      data: '[]',
      headers: {},
      config: axiosError.config ?? ({} as never),
    };
    mockedGet.mockRejectedValueOnce(axiosError);

    try {
      await fetchAdminOnboardings();
      throw new Error('Expected promise to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(AdminOnboardingsFetchError);
      const typedError = error as AdminOnboardingsFetchError;
      expect(typedError.reason).toBe('request-failed');
      expect(typedError.message).toBe('Request failed with status 500.');
      expect(typedError.status).toBe(500);
    }
  });

  describe('authentication failures', () => {
    function rejectWithStatus(status: number): void {
      const axiosError = new AxiosError(`Request failed with status code ${status}`);
      axiosError.response = {
        status,
        statusText: '',
        data: '',
        headers: {},
        config: axiosError.config ?? ({} as never),
      };
      mockedGet.mockRejectedValueOnce(axiosError);
    }

    it('tells the operator to sign in again for a 401', async () => {
      rejectWithStatus(401);

      await expectFetchError(
        fetchAdminOnboardings(),
        'request-failed',
        'Your session is no longer accepted by the engine. Sign in again.',
      );
    });

    it('tells the operator their account lacks a role for a 403', async () => {
      rejectWithStatus(403);

      await expectFetchError(
        fetchAdminOnboardings(),
        'request-failed',
        'Your account is signed in but is not assigned a role that may view onboardings.',
      );
    });

    it('tells the operator to retry for a 503, since their session is not the problem', async () => {
      // The engine answers 503 when it cannot reach Entra to check the token. Signing in again
      // would not help, so the message must not send the operator down that path.
      rejectWithStatus(503);

      await expectFetchError(
        fetchAdminOnboardings(),
        'request-failed',
        'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
      );
    });
  });

  it.each(['awaiting_manual_review', 'rejected', 'invalid'])(
    'accepts the %s status, which the engine reports but earlier validation rejected',
    async (status) => {
      mockedGet.mockResolvedValue(axiosResponse(paginatedBody([{ ...VALID_RECORD, status }])));

      const { records } = await fetchAdminOnboardings();

      expect(records).toHaveLength(1);
      expect(records[0].status).toBe(status);
    },
  );

  it('accepts an unrecognized status rather than discarding the whole list', async () => {
    mockedGet.mockResolvedValue(
      axiosResponse(
        paginatedBody([VALID_RECORD, { ...VALID_RECORD, status: 'some_future_status' }]),
      ),
    );

    const { records } = await fetchAdminOnboardings();

    expect(records.map((record) => record.status)).toEqual(['awaiting_user', 'some_future_status']);
  });

  it('rejects with an invalid-payload error for a blank status', async () => {
    mockedGet.mockResolvedValue(axiosResponse(paginatedBody([{ ...VALID_RECORD, status: '' }])));

    await expectFetchError(fetchAdminOnboardings(), 'invalid-payload');
  });

  it('reads a pre-pagination bare array as the single page it represents', async () => {
    // An engine that has not been redeployed yet still answers with the unpaginated shape, and
    // ignores the page window, so everything it returns is the one and only page.
    mockedGet.mockResolvedValueOnce(axiosResponse([VALID_RECORD]));

    await expect(fetchAdminOnboardings()).resolves.toEqual({
      records: [VALID_RECORD],
      pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, total: 1, totalPages: 1 },
    });
  });

  it('reports no pages for a pre-pagination empty array', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse([]));

    await expect(fetchAdminOnboardings()).resolves.toEqual({
      records: [],
      pagination: { page: 1, limit: DEFAULT_PAGE_SIZE, total: 0, totalPages: 0 },
    });
  });

  it('reports the requested page size in the window it synthesizes for a bare array', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse([VALID_RECORD]));

    const result = await fetchAdminOnboardings({
      filters: { ...createBlankFilters(), limit: 100 },
      page: 1,
    });

    expect(result.pagination).toEqual({ page: 1, limit: 100, total: 1, totalPages: 1 });
  });

  it('rejects with an invalid-payload error for a body that is neither list shape', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse({ records: [] }));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with an invalid-payload error for a malformed record inside a bare array', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse([{ ...VALID_RECORD, status: '' }]));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with an invalid-payload error when a record is missing a required field', async () => {
    const malformed: Record<string, unknown> = { ...VALID_RECORD };
    delete malformed.onboardingId;
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([malformed])));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with an invalid-payload error when workflowVersion is not a positive integer', async () => {
    const malformed = { ...VALID_RECORD, workflowVersion: 0 };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([malformed])));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with an invalid-payload error when a record is not an object', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([null])));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with an invalid-payload error when the page window is missing', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse({ items: [VALID_RECORD] }));

    await expectFetchError(
      fetchAdminOnboardings(),
      'invalid-payload',
      'Response contains a malformed onboarding record.',
    );
  });

  it('rejects with a request-failed error when the axios request rejects with a plain error', async () => {
    mockedGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expectFetchError(fetchAdminOnboardings(), 'request-failed', 'Failed to fetch');
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
