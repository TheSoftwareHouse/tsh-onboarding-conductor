import { AxiosError } from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_CONNECTORS_ENDPOINT,
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
  readConnectorSettingsIssues,
  type Connector,
} from './connectors';
import { ApiError } from '@/services/api/api-error';

const { mockedGet, mockedPatch, mockedDelete } = vi.hoisted(() => {
  const mockedGet = vi.fn();
  const mockedPatch = vi.fn();
  const mockedDelete = vi.fn();
  return { mockedGet, mockedPatch, mockedDelete };
});

vi.mock('@/services/api/http-client', () => ({
  httpClient: { get: mockedGet, patch: mockedPatch, delete: mockedDelete },
}));

const VALID_CONNECTOR: Connector = {
  id: 'smtp',
  type: 'email_delivery',
  name: 'SMTP',
  configured: true,
  settings: [
    { key: 'host', secret: false, required: true, source: 'stored', value: 'mail.example.com' },
    { key: 'password', secret: true, required: true, source: 'stored' },
  ],
  updatedAt: '2026-08-25T00:00:00.000Z',
  updatedBy: 'operator@example.com',
};

function listResponse(connectors: unknown[]): { data: unknown } {
  return { data: { connectors } };
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPatch.mockReset();
  mockedDelete.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchConnectors', () => {
  it('requests the admin connectors path against the shared http client', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([VALID_CONNECTOR]));

    await fetchConnectors();

    expect(mockedGet).toHaveBeenCalledWith(ADMIN_CONNECTORS_ENDPOINT);
  });

  it('returns the connectors projected onto the declared fields', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([VALID_CONNECTOR]));

    await expect(fetchConnectors()).resolves.toEqual([VALID_CONNECTOR]);
  });

  it('drops a field the endpoint may add beyond the ones the card renders', async () => {
    mockedGet.mockResolvedValueOnce(
      listResponse([{ ...VALID_CONNECTOR, secretHint: 'do-not-render-me' }]),
    );

    const result = await fetchConnectors();

    expect(result).toEqual([VALID_CONNECTOR]);
    expect(result[0]).not.toHaveProperty('secretHint');
  });

  it('reports a malformed connector rather than rendering a partial list', async () => {
    mockedGet.mockResolvedValueOnce(listResponse([{ ...VALID_CONNECTOR, type: undefined }]));

    await expect(fetchConnectors()).rejects.toMatchObject({
      name: 'ApiError',
      kind: 'invalid-payload',
      message: 'Response contains a malformed connector.',
    });
  });

  it.each([
    [401, 'Your session is no longer accepted by the engine. Sign in again.'],
    [403, 'Your account is signed in but is not assigned a role that may view connectors.'],
    [500, 'Request failed with status 500.'],
  ])(
    'carries the status and the describeRequestFailure message for a %s response',
    async (status, message) => {
      const axiosError = new AxiosError(`Request failed with status code ${status}`);
      axiosError.response = { status } as AxiosError['response'];
      mockedGet.mockRejectedValueOnce(axiosError);

      await expect(fetchConnectors()).rejects.toMatchObject({
        name: 'ApiError',
        kind: 'request-failed',
        status,
        message,
      });
    },
  );

  it('surfaces the underlying message when the request never reached the engine', async () => {
    mockedGet.mockRejectedValueOnce(new Error('Network Error'));

    await expect(fetchConnectors()).rejects.toMatchObject({
      kind: 'request-failed',
      message: 'Network Error',
    });
  });
});

describe('patchConnectorSettings', () => {
  it('sends a PATCH with the changes nested under settings, and no query parameters', async () => {
    mockedPatch.mockResolvedValueOnce({ data: VALID_CONNECTOR });

    await patchConnectorSettings('smtp', { host: 'mail.example.com' });

    expect(mockedPatch).toHaveBeenCalledWith(`${ADMIN_CONNECTORS_ENDPOINT}/smtp`, {
      settings: { host: 'mail.example.com' },
    });
  });

  it('serialises a null value as a deletion rather than dropping it from the body', async () => {
    mockedPatch.mockResolvedValueOnce({ data: VALID_CONNECTOR });

    await patchConnectorSettings('smtp', { password: null });

    expect(mockedPatch).toHaveBeenCalledWith(`${ADMIN_CONNECTORS_ENDPOINT}/smtp`, {
      settings: { password: null },
    });
  });

  it('returns the connector the engine reports after the write', async () => {
    mockedPatch.mockResolvedValueOnce({ data: VALID_CONNECTOR });

    await expect(patchConnectorSettings('smtp', {})).resolves.toEqual(VALID_CONNECTOR);
  });

  it('parses a 400 CONNECTOR_SETTINGS_INVALID body into issues', async () => {
    const axiosError = new AxiosError('Request failed with status code 400');
    axiosError.response = {
      status: 400,
      data: {
        code: 'CONNECTOR_SETTINGS_INVALID',
        message: 'CONNECTOR_SETTINGS_INVALID',
        issues: [{ key: 'username', reason: 'missing_pairing' }],
      },
    } as AxiosError['response'];
    mockedPatch.mockRejectedValueOnce(axiosError);

    const error = await patchConnectorSettings('smtp', {}).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 400, code: 'CONNECTOR_SETTINGS_INVALID' });
    expect(readConnectorSettingsIssues(error as ApiError)).toEqual([
      { key: 'username', reason: 'missing_pairing' },
    ]);
  });

  it('yields an empty issues array for a non-400 write failure', async () => {
    const axiosError = new AxiosError('Request failed with status code 503');
    axiosError.response = { status: 503 } as AxiosError['response'];
    mockedPatch.mockRejectedValueOnce(axiosError);

    const error = await patchConnectorSettings('smtp', {}).catch((cause: unknown) => cause);

    expect(error).toMatchObject({
      status: 503,
      message:
        'The engine cannot verify sign-ins right now. This is not a problem with your account — try again shortly.',
    });
    expect(readConnectorSettingsIssues(error as ApiError)).toEqual([]);
  });

  it('yields an empty issues array for a 400 body that is not CONNECTOR_SETTINGS_INVALID', async () => {
    const axiosError = new AxiosError('Request failed with status code 400');
    axiosError.response = {
      status: 400,
      data: { code: 'SOME_OTHER_ERROR', message: 'SOME_OTHER_ERROR' },
    } as AxiosError['response'];
    mockedPatch.mockRejectedValueOnce(axiosError);

    const error = await patchConnectorSettings('smtp', {}).catch((cause: unknown) => cause);

    expect(readConnectorSettingsIssues(error as ApiError)).toEqual([]);
  });
});

describe('deleteConnectorSettings', () => {
  it('sends the clear request to the connector path', async () => {
    mockedDelete.mockResolvedValueOnce({ data: undefined });

    await deleteConnectorSettings('smtp');

    expect(mockedDelete).toHaveBeenCalledWith(`${ADMIN_CONNECTORS_ENDPOINT}/smtp`);
  });

  it('reports a failed clear the same way a failed replace is reported', async () => {
    const axiosError = new AxiosError('Request failed with status code 404');
    axiosError.response = { status: 404 } as AxiosError['response'];
    mockedDelete.mockRejectedValueOnce(axiosError);

    await expect(deleteConnectorSettings('unknown-type')).rejects.toMatchObject({
      name: 'ApiError',
      status: 404,
    });
  });
});
