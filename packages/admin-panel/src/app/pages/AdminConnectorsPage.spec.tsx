import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminConnectorsPage } from './AdminConnectorsPage';
import {
  ConnectorSettingsWriteError,
  ConnectorsFetchError,
  deleteConnectorSettings,
  fetchConnectors,
  replaceConnectorSettings,
} from '@/features/connectors/api/admin-connectors';
import type { Connector } from '@/features/connectors';
import { describeConnectorSettingsIssue } from '@/features/connectors/utils/connector-settings-form';

vi.mock('@/features/connectors/api/admin-connectors', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/connectors/api/admin-connectors')>();

  return {
    ...actual,
    fetchConnectors: vi.fn(),
    replaceConnectorSettings: vi.fn(),
    deleteConnectorSettings: vi.fn(),
  };
});

const mockedFetchConnectors = vi.mocked(fetchConnectors);
const mockedReplaceConnectorSettings = vi.mocked(replaceConnectorSettings);
const mockedDeleteConnectorSettings = vi.mocked(deleteConnectorSettings);

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    type: 'smtp',
    name: 'SMTP',
    configured: false,
    allowAdditionalKeys: false,
    settings: [
      { key: 'host', secret: false, required: true, source: 'unset' },
      { key: 'password', secret: true, required: true, source: 'unset' },
    ],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

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
    <MemoryRouter initialEntries={['/connectors']}>
      <QueryClientProvider client={client}>
        <AdminConnectorsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function renderReady(connectors: Connector[]): Promise<void> {
  mockedFetchConnectors.mockResolvedValueOnce(connectors);
  renderPage();
  await waitFor(() => {
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchConnectors.mockReset();
  mockedReplaceConnectorSettings.mockReset();
  mockedDeleteConnectorSettings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AdminConnectorsPage', () => {
  it('shows a loading status while the list is being fetched', () => {
    const { promise } = deferred<Connector[]>();
    mockedFetchConnectors.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading connectors…');
  });

  it('explains a failed request instead of showing an empty list', async () => {
    mockedFetchConnectors.mockRejectedValueOnce(
      new ConnectorsFetchError('request-failed', 'Request failed with status 500.', 500),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load connectors: Request failed with status 500.',
      );
    });
  });

  it('renders one card per connector the engine reports', async () => {
    await renderReady([
      createConnector(),
      createConnector({ type: 'sendgrid_email', name: 'SendGrid' }),
    ]);

    expect(screen.getByRole('form', { name: 'SMTP connector settings' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'SendGrid connector settings' })).toBeInTheDocument();
  });

  it('saves the typed values and reports success', async () => {
    await renderReady([createConnector()]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host (required)'), 'smtp.example.com');

    const updatedConnector = createConnector({
      configured: true,
      updatedAt: '2026-08-25T12:00:00.000Z',
      updatedBy: 'operator@tsh.io',
      settings: [
        { key: 'host', secret: false, required: true, source: 'stored', value: 'smtp.example.com' },
        { key: 'password', secret: true, required: true, source: 'unset' },
      ],
    });
    mockedReplaceConnectorSettings.mockResolvedValueOnce(updatedConnector);
    mockedFetchConnectors.mockResolvedValueOnce([updatedConnector]);

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedReplaceConnectorSettings).toHaveBeenCalledWith('smtp', {
        host: 'smtp.example.com',
      });
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('SMTP settings saved.');
    });
  });

  it('shows the engine issues under the offending field while keeping what the operator typed', async () => {
    await renderReady([createConnector()]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host (required)'), 'not-a-host');

    mockedReplaceConnectorSettings.mockRejectedValueOnce(
      new ConnectorSettingsWriteError('One or more settings were rejected.', 400, [
        { key: 'host', reason: 'invalid_format' },
      ]),
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        within(card).getByText(describeConnectorSettingsIssue('invalid_format')),
      ).toBeInTheDocument();
    });
    expect(within(card).getByLabelText('host (required)')).toHaveValue('not-a-host');
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });

  it('reports a connector as unconfigured after a successful clear, and empties its inputs', async () => {
    await renderReady([
      createConnector({
        configured: true,
        updatedAt: '2026-08-25T12:00:00.000Z',
        updatedBy: 'operator@tsh.io',
        settings: [
          {
            key: 'host',
            secret: false,
            required: true,
            source: 'stored',
            value: 'smtp.example.com',
          },
          { key: 'password', secret: true, required: true, source: 'stored' },
        ],
      }),
    ]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    expect(within(card).getByText('Configured')).toBeInTheDocument();
    expect(within(card).getByLabelText('host (required)')).toHaveValue('smtp.example.com');

    mockedDeleteConnectorSettings.mockResolvedValueOnce(undefined);
    mockedFetchConnectors.mockResolvedValueOnce([createConnector()]);

    const clearButton = within(card).getByRole('button', { name: 'Clear' });
    await userEvent.click(clearButton);
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm clear' }));

    await waitFor(() => {
      expect(mockedDeleteConnectorSettings).toHaveBeenCalledWith('smtp');
    });
    await waitFor(() => {
      expect(within(card).getByText('Not configured')).toBeInTheDocument();
    });
    // The reseed this triggers must actually run against the refetched (now-unset) list, not
    // leave the pre-clear draft in place — otherwise the host input would still show the value
    // Clear just removed on the engine.
    expect(within(card).getByLabelText('host (required)')).toHaveValue('');
  });

  it('keeps Save disabled for a stored secret after a successful save reseeds the draft', async () => {
    await renderReady([createConnector()]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host (required)'), 'smtp.example.com');
    await userEvent.type(
      within(card).getByLabelText('password (required, secret)'),
      's3cret-value',
    );

    const updatedConnector = createConnector({
      configured: true,
      updatedAt: '2026-08-25T12:00:00.000Z',
      updatedBy: 'operator@tsh.io',
      settings: [
        { key: 'host', secret: false, required: true, source: 'stored', value: 'smtp.example.com' },
        { key: 'password', secret: true, required: true, source: 'stored' },
      ],
    });
    mockedReplaceConnectorSettings.mockResolvedValueOnce(updatedConnector);
    mockedFetchConnectors.mockResolvedValueOnce([updatedConnector]);

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('SMTP settings saved.');
    });

    // The reseed must actually run against the refetched list — a secret field always starts
    // empty, so once `source` catches up to `stored`, the empty box now means "would delete the
    // credential just stored" and the guard must refuse a second save, not the stale `unset`
    // draft that let the first write's own secret box slip through empty.
    await waitFor(() => {
      expect(within(card).getByLabelText('password (required, secret)')).toHaveValue('');
    });
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(
      within(card).getByText(/Save stays disabled until it is re-entered/),
    ).toBeInTheDocument();
  });
});
