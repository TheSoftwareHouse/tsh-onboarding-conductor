import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
  type Connector,
} from '@/api/connectors/connectors';
import { ApiError } from '@/services/api/api-error';
import { Toaster } from '@/components/ui/Toast/Toaster';
import { ConnectorsPage } from './ConnectorsPage';
import { describeConnectorSettingsIssue } from './utils/connector-settings-form';

vi.mock('@/api/connectors/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/connectors/connectors')>();

  return {
    ...actual,
    fetchConnectors: vi.fn(),
    patchConnectorSettings: vi.fn(),
    deleteConnectorSettings: vi.fn(),
  };
});

const mockedFetchConnectors = vi.mocked(fetchConnectors);
const mockedPatchConnectorSettings = vi.mocked(patchConnectorSettings);
const mockedDeleteConnectorSettings = vi.mocked(deleteConnectorSettings);

function createConnector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'smtp',
    type: 'email_delivery',
    name: 'SMTP',
    configured: false,
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

function renderPage(initialPath = '/connectors'): ReturnType<typeof render> {
  const client = createQueryClient();

  // `BrowserRouter` reads and writes the same `window.history` the nuqs react-router adapter
  // does, matching production — the `?type=` nav's own `<Link>`s and a direct visit are both
  // observed the same way. See `AuditPage.spec.tsx`.
  window.history.replaceState({}, '', initialPath);

  return render(
    <BrowserRouter>
      <NuqsAdapter>
        <QueryClientProvider client={client}>
          <Toaster>
            <ConnectorsPage eyebrow="Build" title="Connectors" />
          </Toaster>
        </QueryClientProvider>
      </NuqsAdapter>
    </BrowserRouter>,
  );
}

/** The toast root for `title` — `Toast.Title`/`Description` also carry `data-type`, so this walks to the outermost match. */
async function findToast(title: string): Promise<HTMLElement> {
  const nodes = await screen.findAllByText(title);
  for (const node of nodes) {
    let root: Element | null = null;
    for (let current: Element | null = node; current; current = current.parentElement) {
      if (current.hasAttribute('data-type')) {
        root = current;
      }
    }
    if (root) {
      return root as HTMLElement;
    }
  }
  throw new Error(`No toast root found for "${title}"`);
}

async function renderReady(connectors: Connector[], initialPath?: string): Promise<void> {
  mockedFetchConnectors.mockResolvedValueOnce(connectors);
  renderPage(initialPath);
  await waitFor(() => {
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchConnectors.mockReset();
  mockedPatchConnectorSettings.mockReset();
  mockedDeleteConnectorSettings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('ConnectorsPage', () => {
  it('shows a loading status while the list is being fetched', () => {
    const { promise } = deferred<Connector[]>();
    mockedFetchConnectors.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading connectors…');
    // A list nobody has read yet is not an empty list.
    expect(screen.queryByText('No connectors are configurable.')).not.toBeInTheDocument();
  });

  it('renders no connector-type nav while the list is loading', () => {
    const { promise } = deferred<Connector[]>();
    mockedFetchConnectors.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.queryByRole('navigation', { name: 'Connector type' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not implemented')).not.toBeInTheDocument();
  });

  it("tracks each card's in-flight write separately when two saves overlap", async () => {
    const user = userEvent.setup();
    // `password` stored on both, so an empty secret box does not block the save — as in
    // 'saves the typed values and reports success'.
    const settings: Connector['settings'] = [
      { key: 'host', secret: false, required: true, source: 'unset' },
      { key: 'password', secret: true, required: true, source: 'stored' },
    ];
    await renderReady([
      createConnector({ id: 'smtp', name: 'SMTP', settings }),
      createConnector({ id: 'sendgrid_email', name: 'SendGrid', settings }),
    ]);
    mockedFetchConnectors.mockResolvedValue([
      createConnector({ id: 'smtp', name: 'SMTP', settings }),
      createConnector({ id: 'sendgrid_email', name: 'SendGrid', settings }),
    ]);

    const smtp = within(screen.getByRole('form', { name: 'SMTP connector settings' }));
    const sendgrid = within(screen.getByRole('form', { name: 'SendGrid connector settings' }));

    const smtpSave = deferred<Connector>();
    const sendgridSave = deferred<Connector>();
    mockedPatchConnectorSettings
      .mockReturnValueOnce(smtpSave.promise)
      .mockReturnValueOnce(sendgridSave.promise);

    await user.type(smtp.getByLabelText('host'), 'mail.example.com');
    await user.click(smtp.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(smtp.getByLabelText('host')).toBeDisabled();
    });
    expect(sendgrid.getByLabelText('host')).toBeEnabled();

    // A second card starting its own write must not re-enable the first card's controls
    // mid-flight, which a single shared "which connector is pending" slot above the list did.
    await user.type(sendgrid.getByLabelText('host'), 'api.sendgrid.com');
    await user.click(sendgrid.getByRole('button', { name: 'Save' }));
    await waitFor(() => {
      expect(sendgrid.getByLabelText('host')).toBeDisabled();
    });
    expect(smtp.getByLabelText('host')).toBeDisabled();

    // Nor may the first write settling clear the second's, which that same slot also did.
    smtpSave.resolve(createConnector({ id: 'smtp', name: 'SMTP', configured: true, settings }));
    await waitFor(() => {
      expect(smtp.getByLabelText('host')).toBeEnabled();
    });
    expect(sendgrid.getByLabelText('host')).toBeDisabled();

    sendgridSave.resolve(
      createConnector({ id: 'sendgrid_email', name: 'SendGrid', configured: true, settings }),
    );
    await waitFor(() => {
      expect(sendgrid.getByLabelText('host')).toBeEnabled();
    });
  });

  it('explains a failed request instead of showing an empty list', async () => {
    mockedFetchConnectors.mockRejectedValueOnce(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load connectors: Request failed with status 500.',
      );
    });
    // The point of the test: a failed read must not be reported as "there are none".
    expect(screen.queryByText('No connectors are configurable.')).not.toBeInTheDocument();
  });

  it('says so when the engine reports no configurable connectors at all', async () => {
    await renderReady([]);

    expect(screen.getByText('No connectors are configurable.')).toBeInTheDocument();
  });

  it('renders no connector-type nav after a failed request', async () => {
    mockedFetchConnectors.mockRejectedValueOnce(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load connectors: Request failed with status 500.',
      );
    });
    expect(screen.queryByRole('navigation', { name: 'Connector type' })).not.toBeInTheDocument();
    expect(screen.queryByText('Not implemented')).not.toBeInTheDocument();
  });

  it('renders one card per connector the engine reports', async () => {
    await renderReady([
      createConnector(),
      createConnector({ id: 'sendgrid_email', name: 'SendGrid' }),
    ]);

    expect(screen.getByRole('form', { name: 'SMTP connector settings' })).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'SendGrid connector settings' })).toBeInTheDocument();
  });

  it('lists the type nav in declared capability order, not the order the engine reported connectors', async () => {
    await renderReady([
      createConnector({ id: 'acme_custom', type: 'custom', name: 'Acme Custom' }),
      createConnector({ id: 'twilio_verify', type: 'phone_verification', name: 'Twilio Verify' }),
      createConnector(),
      createConnector({ id: 'sendgrid_email', name: 'SendGrid' }),
    ]);

    const nav = screen.getByRole('navigation', { name: 'Connector type' });
    const links = within(nav)
      .getAllByRole('link')
      .map((link) => link.textContent);

    expect(links).toEqual(['Phone verification 1', 'Email delivery 2', 'Custom 1']);
  });

  it('selects the first populated type by default, and renders only that type', async () => {
    await renderReady([
      createConnector({ id: 'acme_custom', type: 'custom', name: 'Acme Custom' }),
      createConnector({ id: 'twilio_verify', type: 'phone_verification', name: 'Twilio Verify' }),
    ]);

    // `phone_verification` sorts before `custom` in `CONNECTOR_TYPES`, so it is the default.
    expect(
      screen.getByRole('heading', { level: 2, name: 'Phone verification' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('form', { name: 'Twilio Verify connector settings' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('form', { name: 'Acme Custom connector settings' }),
    ).not.toBeInTheDocument();
  });

  it('falls back to the first populated type for an unrecognised `?type=`', async () => {
    await renderReady(
      [
        createConnector({ id: 'acme_custom', type: 'custom', name: 'Acme Custom' }),
        createConnector({ id: 'twilio_verify', type: 'phone_verification', name: 'Twilio Verify' }),
      ],
      '/connectors?type=does-not-exist',
    );

    expect(
      screen.getByRole('heading', { level: 2, name: 'Phone verification' }),
    ).toBeInTheDocument();
  });

  it('commits `?type=` when a nav item is clicked, swapping the visible group', async () => {
    await renderReady([
      createConnector({ id: 'acme_custom', type: 'custom', name: 'Acme Custom' }),
      createConnector({ id: 'twilio_verify', type: 'phone_verification', name: 'Twilio Verify' }),
    ]);

    const customLink = screen.getByRole('link', { name: 'Custom 1' });
    expect(customLink).toHaveAttribute('href', '/connectors?type=custom');

    await userEvent.click(customLink);

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 2, name: 'Custom' })).toBeInTheDocument();
    });
    expect(
      screen.getByRole('form', { name: 'Acme Custom connector settings' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('form', { name: 'Twilio Verify connector settings' }),
    ).not.toBeInTheDocument();
  });

  it('keeps two connectors of the same capability separately addressable', async () => {
    // `smtp` and `sendgrid_email` are both `email_delivery`. Anything keyed on the capability
    // rather than the id — React keys, DOM ids, the card subtitle — collides between them.
    await renderReady([
      createConnector(),
      createConnector({ id: 'sendgrid_email', name: 'SendGrid' }),
    ]);

    const smtpCard = screen.getByRole('form', { name: 'SMTP connector settings' });
    const sendgridCard = screen.getByRole('form', { name: 'SendGrid connector settings' });

    expect(within(smtpCard).getByText(/smtp/)).toBeInTheDocument();
    expect(within(sendgridCard).getByText(/sendgrid_email/)).toBeInTheDocument();

    const fieldId = (card: HTMLElement) => within(card).getByLabelText('host').getAttribute('id');

    expect(fieldId(smtpCard)).not.toBe(fieldId(sendgridCard));
  });

  it('saves the typed values and reports success', async () => {
    // `password` is required but already `stored`, so its empty box must not block saving `host`.
    await renderReady([
      createConnector({
        settings: [
          { key: 'host', secret: false, required: true, source: 'unset' },
          { key: 'password', secret: true, required: true, source: 'stored' },
        ],
      }),
    ]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host'), 'smtp.example.com');

    const updatedConnector = createConnector({
      configured: true,
      updatedAt: '2026-08-25T12:00:00.000Z',
      updatedBy: 'operator@tsh.io',
      settings: [
        { key: 'host', secret: false, required: true, source: 'stored', value: 'smtp.example.com' },
        { key: 'password', secret: true, required: true, source: 'unset' },
      ],
    });
    mockedPatchConnectorSettings.mockResolvedValueOnce(updatedConnector);
    mockedFetchConnectors.mockResolvedValueOnce([updatedConnector]);

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(mockedPatchConnectorSettings).toHaveBeenCalledWith('smtp', {
        host: 'smtp.example.com',
      });
    });
    const toast = await findToast('SMTP settings saved.');
    expect(toast).toHaveAttribute('data-type', 'success');
    // The header status keeps reporting the count, never the write's own outcome.
    await waitFor(() => {
      expect(screen.getByText('1 adapter discovered · 1 configured')).toBeInTheDocument();
    });
  });

  it('shows an error toast when a save fails', async () => {
    // `password` is required but already `stored`, so its empty box must not block this save.
    await renderReady([
      createConnector({
        settings: [
          { key: 'host', secret: false, required: true, source: 'unset' },
          { key: 'password', secret: true, required: true, source: 'stored' },
        ],
      }),
    ]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host'), 'smtp.example.com');

    mockedPatchConnectorSettings.mockRejectedValueOnce(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    const toast = await findToast('Unable to save SMTP:');
    expect(toast).toHaveAttribute('data-type', 'error');
    expect(toast).toHaveTextContent('Request failed with status 500.');
    // Base UI announces a high-priority toast assertively through its hidden alert announcer.
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to save SMTP:');
  });

  it('shows the engine issues under the offending field while keeping what the operator typed', async () => {
    // `password` is required but already `stored`, so its empty box must not block this save.
    await renderReady([
      createConnector({
        settings: [
          { key: 'host', secret: false, required: true, source: 'unset' },
          { key: 'password', secret: true, required: true, source: 'stored' },
        ],
      }),
    ]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host'), 'not-a-host');

    mockedPatchConnectorSettings.mockRejectedValueOnce(
      new ApiError('One or more settings were rejected.', {
        status: 400,
        code: 'CONNECTOR_SETTINGS_INVALID',
        body: {
          code: 'CONNECTOR_SETTINGS_INVALID',
          message: 'CONNECTOR_SETTINGS_INVALID',
          issues: [{ key: 'host', reason: 'invalid_format' }],
        },
      }),
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(
        within(card).getByText(describeConnectorSettingsIssue('invalid_format')),
      ).toBeInTheDocument();
    });
    expect(within(card).getByLabelText('host')).toHaveValue('not-a-host');
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
    expect(within(card).getByLabelText('host')).toHaveValue('smtp.example.com');

    mockedDeleteConnectorSettings.mockResolvedValueOnce(undefined);
    mockedFetchConnectors.mockResolvedValueOnce([createConnector()]);

    const clearButton = within(card).getByRole('button', { name: 'Clear settings' });
    await userEvent.click(clearButton);
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm clear' }));

    await waitFor(() => {
      expect(mockedDeleteConnectorSettings).toHaveBeenCalledWith('smtp');
    });
    await waitFor(() => {
      expect(within(card).getByText('Not configured')).toBeInTheDocument();
    });
    // The card resets itself the moment the clear succeeds, straight to empty defaults — it does
    // not wait on the refetch, so the host input reflects the delete immediately.
    expect(within(card).getByLabelText('host')).toHaveValue('');

    const toast = await findToast('SMTP settings cleared.');
    expect(toast).toHaveAttribute('data-type', 'success');
  });

  it('shows an error toast when a clear fails', async () => {
    await renderReady([
      createConnector({
        configured: true,
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
    mockedDeleteConnectorSettings.mockRejectedValueOnce(
      new ApiError('Request failed with status 500.', { status: 500 }),
    );

    await userEvent.click(within(card).getByRole('button', { name: 'Clear settings' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm clear' }));

    const toast = await findToast('Unable to clear SMTP:');
    expect(toast).toHaveAttribute('data-type', 'error');
    expect(toast).toHaveTextContent('Request failed with status 500.');
    // Base UI announces a high-priority toast assertively through its hidden alert announcer.
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to clear SMTP:');
  });

  it('empties a typed box on clear even when the refetched list is unchanged', async () => {
    // Nothing was stored, so the post-clear list is deeply equal to the pre-clear one and React
    // Query's structural sharing hands back the same reference — nothing about the refetch tells
    // the card its clear succeeded. The clear callback's own outcome does that instead.
    await renderReady([createConnector()]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host'), 'smtp.example.com');
    expect(within(card).getByLabelText('host')).toHaveValue('smtp.example.com');

    mockedDeleteConnectorSettings.mockResolvedValueOnce(undefined);
    mockedFetchConnectors.mockResolvedValueOnce([createConnector()]);

    await userEvent.click(within(card).getByRole('button', { name: 'Clear settings' }));
    await userEvent.click(within(card).getByRole('button', { name: 'Confirm clear' }));

    await waitFor(() => {
      expect(within(card).getByLabelText('host')).toHaveValue('');
    });
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('keeps Save disabled for a stored secret after a successful save resets the form', async () => {
    await renderReady([createConnector()]);

    const card = screen.getByRole('form', { name: 'SMTP connector settings' });
    await userEvent.type(within(card).getByLabelText('host'), 'smtp.example.com');
    await userEvent.type(within(card).getByLabelText('password'), 's3cret-value');

    const updatedConnector = createConnector({
      configured: true,
      updatedAt: '2026-08-25T12:00:00.000Z',
      updatedBy: 'operator@tsh.io',
      settings: [
        { key: 'host', secret: false, required: true, source: 'stored', value: 'smtp.example.com' },
        { key: 'password', secret: true, required: true, source: 'stored' },
      ],
    });
    mockedPatchConnectorSettings.mockResolvedValueOnce(updatedConnector);
    mockedFetchConnectors.mockResolvedValueOnce([updatedConnector]);

    await userEvent.click(within(card).getByRole('button', { name: 'Save' }));

    await findToast('SMTP settings saved.');

    // The card resets from what it just sent, not from the refetched (not-yet-resolved) connector:
    // the secret box goes back to empty and becomes the new default, so Save reflects "no changes
    // were made" rather than the just-saved value still looking like a pending edit.
    await waitFor(() => {
      expect(within(card).getByLabelText('password')).toHaveValue('');
    });
    expect(within(card).getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});
