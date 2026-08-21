import { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectorSettingsFetchError,
  fetchConnectorSettings,
  saveConnectorSettings,
} from './admin-connector-settings';
import { CONNECTOR_ENDPOINTS } from '../constants/endpoints';

const { mockedGet, mockedPut } = vi.hoisted(() => ({ mockedGet: vi.fn(), mockedPut: vi.fn() }));

vi.mock('@/shared/api/http-client', () => ({
  httpClient: { get: mockedGet, put: mockedPut },
}));

const SENDGRID = {
  connectorType: 'sendgrid_email',
  label: 'SendGrid email',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      source: 'database',
      value: null,
    },
    {
      key: 'from',
      label: 'Sender address',
      secret: false,
      required: true,
      hint: 'Must be a verified SendGrid sender.',
      source: 'environment',
      value: 'ops@example.com',
    },
  ],
};

function requestFailure(status: number, data?: unknown): AxiosError {
  return new AxiosError('failed', 'ERR', undefined, undefined, {
    status,
    statusText: '',
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });
}

beforeEach(() => {
  mockedGet.mockReset();
  mockedPut.mockReset();
});

describe('fetchConnectorSettings', () => {
  it('projects every connector the endpoint reports', async () => {
    mockedGet.mockResolvedValueOnce({ data: { items: [SENDGRID] } });

    await expect(fetchConnectorSettings()).resolves.toEqual([SENDGRID]);
    expect(mockedGet).toHaveBeenCalledWith(CONNECTOR_ENDPOINTS.adminConnectorSettings);
  });

  it('drops fields the engine adds later rather than passing them to the form', async () => {
    mockedGet.mockResolvedValueOnce({
      data: {
        items: [
          {
            ...SENDGRID,
            introducedLater: 'ignored',
            fields: [{ ...SENDGRID.fields[0], introducedLater: 'ignored' }],
          },
        ],
      },
    });

    const [connector] = await fetchConnectorSettings();

    expect(connector).not.toHaveProperty('introducedLater');
    expect(connector.fields[0]).not.toHaveProperty('introducedLater');
  });

  it('refuses a payload with an unknown source instead of rendering it', async () => {
    mockedGet.mockResolvedValueOnce({
      data: { items: [{ ...SENDGRID, fields: [{ ...SENDGRID.fields[0], source: 'somewhere' }] }] },
    });

    await expect(fetchConnectorSettings()).rejects.toMatchObject({ reason: 'invalid-payload' });
  });

  it('explains a refused request by its status', async () => {
    mockedGet.mockRejectedValueOnce(requestFailure(403));

    const error = await fetchConnectorSettings().catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(ConnectorSettingsFetchError);
    expect((error as ConnectorSettingsFetchError).status).toBe(403);
    expect((error as ConnectorSettingsFetchError).message).toContain('connector settings');
  });
});

describe('saveConnectorSettings', () => {
  it('sends only the submitted values and returns the connector as it now stands', async () => {
    mockedPut.mockResolvedValueOnce({ data: SENDGRID });

    await expect(
      saveConnectorSettings('sendgrid_email', { apiKey: 'SG.rotated' }),
    ).resolves.toEqual(SENDGRID);
    expect(mockedPut).toHaveBeenCalledWith(
      `${CONNECTOR_ENDPOINTS.adminConnectorSettings}/sendgrid_email`,
      { values: { apiKey: 'SG.rotated' } },
    );
  });

  it('reports what an operator can do about a missing engine encryption key', async () => {
    mockedPut.mockRejectedValueOnce(
      requestFailure(503, { code: 'CONNECTOR_SETTINGS_ENCRYPTION_UNAVAILABLE' }),
    );

    await expect(saveConnectorSettings('sendgrid_email', { apiKey: 'SG.x' })).rejects.toThrow(
      /CONNECTOR_SETTINGS_ENCRYPTION_KEY/,
    );
  });
});
