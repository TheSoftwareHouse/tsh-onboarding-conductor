import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vi } from 'vitest';
import {
  ADMIN_WORKFLOWS_LIST,
  AdminWorkflowsFetchError,
  fetchAdminWorkflows,
  WORKFLOW_SCOPES,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowSummary,
} from './admin-workflows';

const { mockedGet } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  return { mockedGet };
});

vi.mock('@/services/api/http-client', () => ({
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
    expect(error).toBeInstanceOf(AdminWorkflowsFetchError);
    const typedError = error as AdminWorkflowsFetchError;
    expect(typedError.reason).toBe(reason);
    if (message !== undefined) {
      expect(typedError.message).toBe(message);
    }
  }
}

const VALID_RECORD: AdminWorkflowSummary = {
  workflowId: 'kyc-basic',
  name: 'KYC Basic',
  scope: 'built-in',
  servingVersion: 2,
  versionCount: 3,
  draftCount: 1,
  inProgressCount: 4,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
};

const FIRST_PAGE_WINDOW = { page: 1, limit: 20, total: 1, totalPages: 1 };

const DEFAULT_PAGE_PARAMS: AdminWorkflowQueryFilters = {
  page: 1,
  limit: 20,
  search: null,
  scope: null,
  hasDraft: null,
};

/** What `DEFAULT_PAGE_PARAMS` becomes on the wire: `hasDraft` never travels except as `true`. */
const EXPECTED_DEFAULT_REQUEST_PARAMS = {
  page: 1,
  limit: 20,
  search: null,
  scope: null,
};

function paginatedBody(
  items: unknown[],
  pagination: Record<string, number> = { ...FIRST_PAGE_WINDOW, total: items.length },
) {
  return { items, meta: { pagination } };
}

function axiosResponse<T>(data: T): { data: T } {
  return { data };
}

function defaultQueryFilters(): AdminWorkflowQueryFilters {
  return { ...DEFAULT_PAGE_PARAMS };
}

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchAdminWorkflows', () => {
  it('requests the admin workflows path with the given query filters against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([VALID_RECORD])));

    await expect(fetchAdminWorkflows(defaultQueryFilters())).resolves.toEqual({
      records: [VALID_RECORD],
      pagination: FIRST_PAGE_WINDOW,
    });

    expect(mockedGet).toHaveBeenCalledTimes(1);
    expect(mockedGet).toHaveBeenCalledWith(ADMIN_WORKFLOWS_LIST, {
      params: EXPECTED_DEFAULT_REQUEST_PARAMS,
    });
  });

  it('carries no hasDraft parameter for a fully blank filter set', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));
    await fetchAdminWorkflows(defaultQueryFilters());

    const [, requestConfig] = mockedGet.mock.calls[0] as [
      string,
      { params: Record<string, unknown> },
    ];
    expect(requestConfig.params).toEqual(EXPECTED_DEFAULT_REQUEST_PARAMS);
  });

  it('sends hasDraft only when it is true, never when false', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));
    await fetchAdminWorkflows({ ...defaultQueryFilters(), hasDraft: false });

    const [, requestConfig] = mockedGet.mock.calls[0] as [
      string,
      { params: Record<string, unknown> },
    ];
    expect(requestConfig.params).not.toHaveProperty('hasDraft');
  });

  it('sends hasDraft=true when the filter is set', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));
    await fetchAdminWorkflows({ ...defaultQueryFilters(), hasDraft: true });

    expect(mockedGet).toHaveBeenCalledWith(ADMIN_WORKFLOWS_LIST, {
      params: { ...EXPECTED_DEFAULT_REQUEST_PARAMS, hasDraft: true },
    });
  });

  it('forwards every already-normalized filter through to request params, unmodified', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([])));

    await fetchAdminWorkflows({
      ...defaultQueryFilters(),
      search: 'kyc',
      scope: 'users',
    });

    expect(mockedGet).toHaveBeenCalledWith(ADMIN_WORKFLOWS_LIST, {
      params: { ...EXPECTED_DEFAULT_REQUEST_PARAMS, search: 'kyc', scope: 'users' },
    });
  });

  it('asks for the requested page rather than always the first one', async () => {
    mockedGet.mockResolvedValueOnce(
      axiosResponse(paginatedBody([], { page: 3, limit: 50, total: 120, totalPages: 3 })),
    );

    const page = await fetchAdminWorkflows({ ...defaultQueryFilters(), page: 3, limit: 50 });

    expect(mockedGet).toHaveBeenCalledWith(ADMIN_WORKFLOWS_LIST, {
      params: { ...EXPECTED_DEFAULT_REQUEST_PARAMS, page: 3, limit: 50 },
    });
    expect(page.pagination).toEqual({ page: 3, limit: 50, total: 120, totalPages: 3 });
  });

  it.each(WORKFLOW_SCOPES)('accepts the %s scope', async (scope) => {
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([{ ...VALID_RECORD, scope }])));

    const { records } = await fetchAdminWorkflows(defaultQueryFilters());

    expect(records[0].scope).toBe(scope);
  });

  it('accepts a null servingVersion for a workflow with nothing published', async () => {
    const record = { ...VALID_RECORD, servingVersion: null };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([record])));

    const { records } = await fetchAdminWorkflows(defaultQueryFilters());

    expect(records).toEqual([record]);
  });

  it('accepts a null name', async () => {
    const record = { ...VALID_RECORD, name: null };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([record])));

    const { records } = await fetchAdminWorkflows(defaultQueryFilters());

    expect(records).toEqual([record]);
  });

  it('drops unexpected extra fields while preserving the projection', async () => {
    const rawRecord = { ...VALID_RECORD, definition: { steps: [] } };
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([rawRecord])));

    await expect(fetchAdminWorkflows(defaultQueryFilters())).resolves.toEqual({
      records: [VALID_RECORD],
      pagination: FIRST_PAGE_WINDOW,
    });
  });

  it('rejects with an invalid-payload error for an unrecognized scope', async () => {
    mockedGet.mockResolvedValueOnce(
      axiosResponse(paginatedBody([{ ...VALID_RECORD, scope: 'not-a-scope' }])),
    );

    await expectFetchError(
      fetchAdminWorkflows(defaultQueryFilters()),
      'invalid-payload',
      'Response contains a malformed workflow summary.',
    );
  });

  it('rejects with an invalid-payload error when a record is missing a required field', async () => {
    const malformed: Record<string, unknown> = { ...VALID_RECORD };
    delete malformed.workflowId;
    mockedGet.mockResolvedValueOnce(axiosResponse(paginatedBody([malformed])));

    await expectFetchError(
      fetchAdminWorkflows(defaultQueryFilters()),
      'invalid-payload',
      'Response contains a malformed workflow summary.',
    );
  });

  it('rejects with an invalid-payload error when the page window is missing', async () => {
    mockedGet.mockResolvedValueOnce(axiosResponse({ items: [VALID_RECORD] }));

    await expectFetchError(
      fetchAdminWorkflows(defaultQueryFilters()),
      'invalid-payload',
      'Response contains a malformed workflow summary.',
    );
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

    await expectFetchError(
      fetchAdminWorkflows(defaultQueryFilters()),
      'request-failed',
      'Request failed with status 500.',
    );
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
        fetchAdminWorkflows(defaultQueryFilters()),
        'request-failed',
        'Your session is no longer accepted by the engine. Sign in again.',
      );
    });

    it('tells the operator their account lacks a role for a 403', async () => {
      rejectWithStatus(403);

      await expectFetchError(
        fetchAdminWorkflows(defaultQueryFilters()),
        'request-failed',
        'Your account is signed in but is not assigned a role that may view workflows.',
      );
    });
  });

  it('rejects with a request-failed error when the axios request rejects with a plain error', async () => {
    mockedGet.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expectFetchError(
      fetchAdminWorkflows(defaultQueryFilters()),
      'request-failed',
      'Failed to fetch',
    );
    expect(mockedGet).toHaveBeenCalledTimes(1);
  });
});
