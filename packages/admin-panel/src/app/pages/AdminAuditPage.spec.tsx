import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminAuditPage } from './AdminAuditPage';
import { AuditEventsFetchError, fetchAuditEvents } from '@/features/audit/api/admin-audit-events';
import type { AuditEventsPage } from '@/features/audit/api/admin-audit-events';
import type { AuditEvent } from '@/features/audit';
import { PageHeader } from '@/shared/components/PageHeader/PageHeader';
import { formatDayLabel } from '@/shared/lib/calendar-month';
import { formatLogDateTime } from '@/shared/lib/format-date-time';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';

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
      limit: DEFAULT_PAGE_SIZE,
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

function renderPage(initialPath = '/audit'): ReturnType<typeof render> {
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

  // The committed criteria live in the URL, so the page needs a router to read and update them.
  // `PageHeader` supplies the action slot `AuditSearch` portals into - without it mounted, the
  // header search would never appear in the document.
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={client}>
        <PageHeader title="Logs" />
        <AdminAuditPage />
      </QueryClientProvider>
    </MemoryRouter>,
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

/**
 * Sets one bound of the window from its calendar, on the month the calendar opens on. A day of the
 * current month is used rather than a named date because that is the month an unset bound offers,
 * and the tests here only care which bound is the later of the two. Only reachable once `Occurred`
 * has been set to `Custom range…`, which is what reveals the `From` / `To` fields.
 */
async function pickDayOfThisMonth(bound: 'From' | 'To', dayOfMonth: number): Promise<void> {
  const day = new Date(new Date().getFullYear(), new Date().getMonth(), dayOfMonth);

  await userEvent.click(screen.getByLabelText(bound));
  const calendar = screen.getByRole('dialog', { name: `${bound}: choose a date and time` });
  await userEvent.click(within(calendar).getByRole('button', { name: formatDayLabel(day) }));
  await userEvent.click(within(calendar).getByRole('button', { name: 'Done' }));
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

    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(1, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    });
  });

  it('restores the criteria the URL carries into both the controls and the request', async () => {
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));
    renderPage('/audit?actorType=operator&action=auth.access_granted&page=2');

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(1);
    });
    // The log an operator left is the log they come back to: same request, same controls.
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(1, {
      page: 2,
      limit: DEFAULT_PAGE_SIZE,
      actorType: 'operator',
      action: 'auth.access_granted',
    });
    expect(screen.getByLabelText('Actor')).toHaveValue('operator');
    expect(screen.getByLabelText('Action')).toHaveValue('auth.access_granted');
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

    expect(within(rows[1]).getByText(formatLogDateTime(EVENT_ONE.occurredAt))).toBeInTheDocument();
    expect(within(rows[1]).getByText('System')).toBeInTheDocument();
    expect(within(rows[1]).getByText('onboarding.started')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Onboardings')).toBeInTheDocument();
    expect(within(rows[1]).getByText(EVENT_ONE.resourceId)).toBeInTheDocument();
    expect(within(rows[1]).getByText('workflowId')).toBeInTheDocument();
    expect(within(rows[1]).getByText('kyc-basic')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Invalid date')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Operator')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Admin API')).toBeInTheDocument();
    expect(within(rows[2]).getByText('-')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 audit events (page 1 of 1).',
    );
  });

  it('sends the criteria the operator applied, omitting the ones left blank', async () => {
    await renderReady(page([EVENT_ONE]));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));

    await userEvent.selectOptions(screen.getByLabelText('Actor'), 'operator');
    await userEvent.type(screen.getByLabelText('Action'), '  auth.access_granted  ');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      actorType: 'operator',
      action: 'auth.access_granted',
    });
  });

  it('refuses a backwards time window as soon as it is entered, without issuing a request', async () => {
    await renderReady(page([EVENT_ONE]));

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Custom range…');
    await pickDayOfThisMonth('From', 20);
    await pickDayOfThisMonth('To', 10);

    // Reported before Apply is reached, so the window is corrected where it was entered.
    expect(screen.getByRole('status')).toHaveTextContent(
      '"Occurred from" must not be later than "Occurred to".',
    );
    expect(screen.getByLabelText('From')).toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(1);
  });

  it('narrows to a relative period without the operator naming a date', async () => {
    await renderReady(page([EVENT_ONE]));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE]));

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Last 24 hours');
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });

    // The period travels as a period. Resolving it to an instant is the request layer's job, and
    // it happens per request, so the window keeps ending at now for as long as this stays applied.
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      occurredPeriod: '24h',
    });
  });

  it('clears both bounds of the window in one action', async () => {
    await renderReady(page([EVENT_ONE]));

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Custom range…');
    await pickDayOfThisMonth('From', 10);
    await pickDayOfThisMonth('To', 20);
    expect(screen.getByLabelText('From')).not.toHaveValue('');

    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'All time');
    // Reopening Custom range proves the bounds themselves were cleared, not just hidden.
    await userEvent.selectOptions(screen.getByLabelText('Occurred'), 'Custom range…');

    expect(screen.getByLabelText('From')).toHaveValue('');
    expect(screen.getByLabelText('To')).toHaveValue('');
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
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 2,
      limit: DEFAULT_PAGE_SIZE,
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Page')).toHaveValue('2');
    });
    expect(screen.getByRole('navigation', { name: 'Audit pages' })).toHaveTextContent('of 3');
  });

  it('jumps straight to the page the operator names', async () => {
    await renderReady(page([EVENT_ONE], { total: 41, totalPages: 3 }));
    mockedFetchAuditEvents.mockResolvedValueOnce(
      page([EVENT_TWO], { page: 3, total: 41, totalPages: 3 }),
    );

    await userEvent.clear(screen.getByLabelText('Page'));
    await userEvent.type(screen.getByLabelText('Page'), '3{Enter}');

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 3,
      limit: DEFAULT_PAGE_SIZE,
    });
    await waitFor(() => {
      expect(screen.getByLabelText('Page')).toHaveValue('3');
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
      limit: DEFAULT_PAGE_SIZE,
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
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
    });
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

  it("keeps the selected tab's resourceType when Apply filters is pressed", async () => {
    await renderReady(page([EVENT_ONE], { total: 1 }));
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));

    // Selecting a tab is a plain navigation - it commits resourceType straight to the URL,
    // without ever touching the filter grid's draft.
    await userEvent.click(screen.getByRole('link', { name: 'Onboardings' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(2, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      resourceType: 'onboarding',
    });

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.click(screen.getByRole('button', { name: 'Apply filters' }));

    // The draft was seeded on mount, before the tab was ever clicked - Apply must not commit
    // that stale copy of resourceType over the one the tab strip already set.
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(3, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      resourceType: 'onboarding',
    });
    expect(screen.getByRole('link', { name: /^Onboardings/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('counts a tab-selected resourceType as an active filter with no grid criteria set', async () => {
    await renderReady(page([EVENT_ONE], { total: 1 }));
    expect(screen.queryByText('1 active')).not.toBeInTheDocument();

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.click(screen.getByRole('link', { name: 'Onboardings' }));

    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText('1 active')).toBeInTheDocument();
  });

  it("keeps the selected tab's resourceType when the header search is submitted", async () => {
    await renderReady(page([EVENT_ONE], { total: 1 }));

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.click(screen.getByRole('link', { name: 'Onboardings' }));
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.type(screen.getByLabelText('Resource ID'), '  abc-123  {Enter}');

    // The draft was seeded on mount, before the tab was ever clicked - the search must narrow
    // within the selected tab rather than committing that stale copy over it.
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(3, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      resourceType: 'onboarding',
      resourceId: 'abc-123',
    });
  });

  it('does not restore a tab the operator left when the header search is submitted', async () => {
    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    renderPage('/audit?resourceType=connector_settings');
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(1);
    });

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.click(screen.getByRole('link', { name: 'All' }));
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(2);
    });

    mockedFetchAuditEvents.mockResolvedValueOnce(page([EVENT_ONE], { total: 1 }));
    await userEvent.type(screen.getByLabelText('Resource ID'), 'abc-123{Enter}');

    // The stale draft still carries connector_settings; committing it would silently re-narrow
    // the trail to a tab the operator had explicitly stepped out of.
    await waitFor(() => {
      expect(mockedFetchAuditEvents).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAuditEvents).toHaveBeenNthCalledWith(3, {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      resourceId: 'abc-123',
    });
  });
});
