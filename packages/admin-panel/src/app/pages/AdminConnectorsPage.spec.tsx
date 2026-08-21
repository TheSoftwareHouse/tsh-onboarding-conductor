import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConnectorsPage } from './AdminConnectorsPage';
import {
  ConnectorSettingsFetchError,
  fetchConnectorSettings,
  saveConnectorSettings,
} from '@/features/connectors/api/admin-connector-settings';
import type { ConnectorSettings } from '@/features/connectors';

vi.mock('@/features/connectors/api/admin-connector-settings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/connectors/api/admin-connector-settings')>();

  return { ...actual, fetchConnectorSettings: vi.fn(), saveConnectorSettings: vi.fn() };
});

const mockedFetch = vi.mocked(fetchConnectorSettings);
const mockedSave = vi.mocked(saveConnectorSettings);

const SENDGRID: ConnectorSettings = {
  connectorType: 'sendgrid_email',
  label: 'SendGrid email',
  fields: [
    {
      key: 'apiKey',
      label: 'API key',
      secret: true,
      required: true,
      source: 'environment',
      value: null,
    },
  ],
};

const SMTP: ConnectorSettings = {
  connectorType: 'smtp',
  label: 'SMTP',
  fields: [
    { key: 'host', label: 'Host', secret: false, required: true, source: 'unset', value: null },
  ],
};

function renderPage(): ReturnType<typeof render> {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <AdminConnectorsPage />
    </QueryClientProvider>,
  );
}

async function renderReady(connectors: ConnectorSettings[]): Promise<void> {
  mockedFetch.mockResolvedValueOnce(connectors);
  renderPage();
  await waitFor(() => {
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('form', { name: connectors[0].label });
}

beforeEach(() => {
  mockedFetch.mockReset();
  mockedSave.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AdminConnectorsPage', () => {
  it('renders one form per configurable connector', async () => {
    await renderReady([SENDGRID, SMTP]);

    expect(screen.getAllByRole('form').map((form) => form.getAttribute('aria-label'))).toEqual([
      'SendGrid email',
      'SMTP',
    ]);
    expect(screen.getAllByRole('status')[0]).toHaveTextContent(
      'Showing 2 configurable connectors.',
    );
  });

  it('explains a refused load instead of showing empty forms', async () => {
    mockedFetch.mockRejectedValueOnce(
      new ConnectorSettingsFetchError('request-failed', 'Your session is no longer accepted.', 401),
    );

    renderPage();

    expect(
      await screen.findByText(
        'Unable to load connector settings: Your session is no longer accepted.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
  });

  it('saves one connector and reports the result on that connector only', async () => {
    await renderReady([SENDGRID, SMTP]);
    mockedSave.mockResolvedValueOnce({
      ...SENDGRID,
      fields: [{ ...SENDGRID.fields[0], source: 'database' }],
    });

    const sendgridForm = screen.getByRole('form', { name: 'SendGrid email' });

    await userEvent.type(within(sendgridForm).getByLabelText(/API key/), 'SG.rotated');
    await userEvent.click(within(sendgridForm).getByRole('button', { name: 'Save changes' }));

    expect(mockedSave).toHaveBeenCalledWith('sendgrid_email', { apiKey: 'SG.rotated' });
    await waitFor(() => {
      expect(sendgridForm).toHaveTextContent(
        'Saved. The new values are used from the next connector call onwards.',
      );
    });
    expect(screen.getByRole('form', { name: 'SMTP' })).not.toHaveTextContent('Saved.');
    // The response replaces the connector in the cache rather than triggering a second read.
    expect(sendgridForm).toHaveTextContent('Saved here');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('reports a refused save on the form that was submitted, keeping the edit', async () => {
    await renderReady([SENDGRID]);
    mockedSave.mockRejectedValueOnce(
      new ConnectorSettingsFetchError('request-failed', 'The engine has no encryption key.', 503),
    );

    await userEvent.type(screen.getByLabelText(/API key/), 'SG.rotated');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(await screen.findByText('The engine has no encryption key.')).toBeInTheDocument();
    expect(screen.getByLabelText(/API key/)).toHaveValue('SG.rotated');
  });

  it('reloads only when asked', async () => {
    await renderReady([SENDGRID]);
    mockedFetch.mockResolvedValueOnce([SENDGRID]);

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetch).toHaveBeenCalledTimes(2);
    });
  });
});
