import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ADMIN_WORKFLOWS_ENDPOINT } from './workflow-definitions';
import { fetchWorkflowVersions, type WorkflowVersion } from './workflow-versions';

const { mockedGet } = vi.hoisted(() => ({ mockedGet: vi.fn() }));

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet },
}));

const VERSIONS: WorkflowVersion[] = [
  {
    version: 2,
    status: 'draft',
    createdAt: '2026-07-03T00:00:00.000Z',
    updatedAt: '2026-07-04T00:00:00.000Z',
  },
  {
    version: 1,
    status: 'retired',
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-02T00:00:00.000Z',
  },
];

beforeEach(() => {
  mockedGet.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchWorkflowVersions', () => {
  it('requests the versions of a path-encoded workflow id', async () => {
    mockedGet.mockResolvedValueOnce({ data: { items: VERSIONS } });

    await fetchWorkflowVersions('kyc basic');

    expect(mockedGet).toHaveBeenCalledWith(`${ADMIN_WORKFLOWS_ENDPOINT}/kyc%20basic/versions`);
  });

  it('returns every listed version, retired and draft included', async () => {
    mockedGet.mockResolvedValueOnce({ data: { items: VERSIONS } });

    await expect(fetchWorkflowVersions('kyc')).resolves.toEqual(VERSIONS);
  });

  it('raises invalid-payload for an unknown status', async () => {
    mockedGet.mockResolvedValueOnce({ data: { items: [{ ...VERSIONS[0], status: 'scheduled' }] } });

    await expect(fetchWorkflowVersions('kyc')).rejects.toMatchObject({
      reason: 'invalid-payload',
      message: 'Response contains a malformed workflow versions list.',
    });
  });

  it('raises request-failed carrying the status for a 404', async () => {
    const axiosError = new AxiosError('Request failed with status code 404');
    axiosError.response = { status: 404 } as AxiosError['response'];
    mockedGet.mockRejectedValueOnce(axiosError);

    await expect(fetchWorkflowVersions('kyc')).rejects.toMatchObject({
      reason: 'request-failed',
      status: 404,
    });
  });

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchWorkflowVersions('kyc')).rejects.toMatchObject({
      reason: 'request-failed',
      message: 'Network Error',
    });
  });
});
