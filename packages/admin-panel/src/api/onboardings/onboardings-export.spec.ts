import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_ONBOARDINGS_EXPORT_ENDPOINT,
  AdminOnboardingsExportError,
  fetchAdminOnboardingsCsv,
  type AdminOnboardingExportFilters,
} from './onboardings-export';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const FILTERS: AdminOnboardingExportFilters = {
  status: 'approved',
  workflowId: 'kyc-basic',
  workflowVersion: null,
  currentStep: null,
  onboardingId: null,
};

function axiosFailure(status: number): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    data: new Blob(['{}']),
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

describe('fetchAdminOnboardingsCsv', () => {
  beforeEach(() => {
    mockedGet.mockReset();
  });

  it('requests the export route as a blob with the filters and no page window', async () => {
    mockedGet.mockResolvedValue({ data: new Blob(['x']) });

    await fetchAdminOnboardingsCsv(FILTERS);

    expect(mockedGet).toHaveBeenCalledWith('/v1/onboardings/export', {
      params: FILTERS,
      responseType: 'blob',
    });
    expect(ADMIN_ONBOARDINGS_EXPORT_ENDPOINT).toBe('/v1/onboardings/export');
    const { params } = mockedGet.mock.calls[0][1] as { params: Record<string, unknown> };
    expect(params).not.toHaveProperty('page');
    expect(params).not.toHaveProperty('limit');
  });

  it('returns the response Blob unchanged', async () => {
    const blob = new Blob(['a,b\r\n']);
    mockedGet.mockResolvedValue({ data: blob });

    await expect(fetchAdminOnboardingsCsv(FILTERS)).resolves.toBe(blob);
  });

  it('wraps an HTTP failure with its status and an operator-facing message', async () => {
    mockedGet.mockRejectedValue(axiosFailure(403));

    const error = await fetchAdminOnboardingsCsv(FILTERS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdminOnboardingsExportError);
    expect((error as AdminOnboardingsExportError).status).toBe(403);
    expect((error as AdminOnboardingsExportError).message).toContain('onboardings export');
  });

  it('wraps a failure without a response using the cause message and no status', async () => {
    mockedGet.mockRejectedValue(new Error('Network Error'));

    const error = await fetchAdminOnboardingsCsv(FILTERS).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(AdminOnboardingsExportError);
    expect((error as AdminOnboardingsExportError).status).toBeUndefined();
    expect((error as AdminOnboardingsExportError).message).toBe('Network Error');
  });
});
