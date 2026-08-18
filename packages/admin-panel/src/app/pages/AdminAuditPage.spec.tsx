import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditPage } from './AdminAuditPage';
import { AuditEventsFetchError, fetchAuditEvents } from '@/features/audit/api/admin-audit-events';
import type { AuditEventsPage } from '@/features/audit/api/admin-audit-events';
import type { AuditEvent } from '@/features/audit';
import { formatDateTime } from '@/shared/lib/format-date-time';

vi.mock('@/features/audit/api/admin-audit-events', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/audit/api/admin-audit-events')>();

  return {
    ...actual,
    fetchAuditEvents: vi.fn(),
  };
});

const mockedFetchAuditEvents = vi.mocked(fetchAuditEvents);

const EVENT_ONE: AuditEvent = {
  id: '018f1e2a-1111-7000-8000-000000000001',
  occurredAt: '2026-07-01T00:00:00.000Z',
  actorType: 'system',
  actorId: 'engine',
  action: 'onboarding.started',
  resourceType: 'onboarding',
  resourceId: '018f1e2a-aaaa-7000-8000-00000000000a',
  metadata: { workflowId: 'kyc-basic' },
};

const EVENT_TWO: AuditEvent = {
  id: '018f1e2a-2222-7000-8000-000000000002',
  occurredAt: 'not-a-real-date',
  actorType: 'operator',
  actorId: 'operator@tsh.io',
  action: 'auth.access_granted',
  resourceType: 'admin_endpoint',
  resourceId: '/v1/admin/audit',
  metadata: {},
};

function page(
  events: AuditEvent[],
  pagination?: Partial<AuditEventsPage['pagination']>,
): AuditEventsPage {
  return {
    events,
    pagination: {
      page: 1,
      limit: 20,
      total: events.length,
      totalPages: events.length === 0 ? 0 : 1,
      ...pagination,
    },
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
    <QueryClientProvider client={client}>
      <AdminAuditPage />
    </QueryClientProvider>,
  );
}

async function renderReady(result: AuditEventsPage): Promise<void> {
  mockedFetchAuditEvents.mockResolvedValueOnce(result);
  renderPage();
  await waitFor(() => {
    expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchAuditEvents.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AdminAuditPage', () => {
  it('requests the first page with the default page size on mount', async () => {
    await renderReady(page([EVENT_ONE]));

    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(1, { page: 1, limit: 20 });
  });

  it('shows a loading status and disables controls while a request is pending', async () => {
    const { promise } = deferred<AuditEventsPage>();
    mockedFetchAuditEvents.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading audit events…');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Audit events results' })).not.toBeInTheDocument();
  });

  it('renders every displayed column, including the invalid-date and empty-metadata fallbacks', async () => {
    await renderReady(page([EVENT_ONE, EVENT_TWO], { total: 2 }));

    const rows = within(screen.getByRole('region', { name: 'Audit events results' })).getAllByRole(
      'row',
    );

    expect(within(rows[1]).getByText(formatDateTime(EVENT_ONE.occurredAt))).toBeInTheDocument();
    expect(within(rows[1]).getByText('System')).toBeInTheDocument();
    expect(within(rows[1]).getByText('onboarding.started')).toBeInTheDocument();
    expect(within(rows[1]).getByText('workflowId')).toBeInTheDocument();
    expect(within(rows[1]).getByText('kyc-basic')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Invalid date')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Operator')).toBeInTheDocument();
    expect(within(rows[2]).getByText('-')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 audit events (page 1 of 1).',
    );
  });

  it('sends the criteria the operator applied, omitting the ones left blank', async () => {
    await renderReady(page([EVENT_ONE]));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));

    await userEvent.selectOptions(screen.getByLabelText('Actor type'), 'operator');
    await userEvent.type(screen.getByLabelText('Action'), '  auth.access_granted  ');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: 20,
      actorType: 'operator',
      action: 'auth.access_granted',
    });
  });

  it('refuses a backwards time window without issuing a request', async () => {
    await renderReady(page([EVENT_ONE]));

    await userEvent.type(screen.getByLabelText('Occurred from'), '2026-07-02T09:00');
    await userEvent.type(screen.getByLabelText('Occurred to'), '2026-07-01T09:00');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByRole('status')).toHaveTextContent(
      '"Occurred from" must not be later than "Occurred to".',
    );
    expect(screen.getByLabelText('Occurred from')).toHaveAttribute('aria-invalid', 'true');
    expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(1);
  });

  it('fetches the next page while keeping the applied criteria', async () => {
    await renderReady(page([EVENT_ONE], { total: 41, totalPages: 3 }));
    mockedFetchAuditEvents.mockResolvedValueOnce(
      page([EVENT_TWO], { page: 2, total: 41, totalPages: 3 }),
    );

    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, { page: 2, limit: 20 });
    await waitFor(() => {
      expect(screen.getByText('Page 2 of 3')).toBeInTheDocument();
    });
  });

  it('returns to the first page when new criteria are applied', async () => {
    await renderReady(page([EVENT_ONE], { total: 41, totalPages: 3 }));
    mockedFetchAuditEvents.mockResolvedValueOnce(
      page([EVENT_TWO], { page: 2, total: 41, totalPages: 3 }),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));
    await userEvent.type(screen.getByLabelText('Actor ID'), 'engine');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(3, {
      page: 1,
      limit: 20,
      actorId: 'engine',
    });
  });

  it('refetches on Reload even though the criteria did not change', async () => {
    await renderReady(page([EVENT_ONE]));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));

    await userEvent.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
  });

  it('clears the criteria and refetches when the filters are reset', async () => {
    await renderReady(page([EVENT_ONE]));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));

    await userEvent.type(screen.getByLabelText('Actor ID'), 'engine');
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, { page: 1, limit: 20 });
    expect(screen.getByLabelText('Actor ID')).toHaveValue('');
  });

  it('explains a failed request instead of showing an empty table', async () => {
    mockedFetchAuditEvents.mockRejectedValueOnce(
      new AuditEventsFetchError('request-failed', 'Request failed with status 500.', 500),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load audit events: Request failed with status 500.',
      );
    });
    expect(screen.queryByRole('region', { name: 'Audit events results' })).not.toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Audit pages' })).not.toBeInTheDocument();
  });

  it('distinguishes an empty trail from one narrowed away by the criteria', async () => {
    await renderReady(page([]));

    expect(screen.getByRole('status')).toHaveTextContent('No audit events were returned.');

    mockedFetchAuditEvents.mockResolvedValueOnce(page([]));
    await userEvent.type(screen.getByLabelText('Actor ID'), 'nobody');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'No audit events match the current filters.',
      );
    });
  });
});
