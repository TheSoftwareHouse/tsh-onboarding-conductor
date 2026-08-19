import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PAGE_SIZE } from '@/shared/lib/pagination';
import { AdminOnboardingsPage } from './AdminOnboardingsPage';
import {
  AdminOnboardingsFetchError,
  fetchAdminOnboardings,
  type AdminOnboardingsPage as AdminOnboardingsPageResult,
} from '@/features/onboarding/api/admin-onboardings';
import {
  createDefaultAdminOnboardingFilters,
  type AdminOnboardingFilters,
  type AdminOnboardingSummary,
} from '@/features/onboarding';

vi.mock('@/features/onboarding/api/admin-onboardings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/onboarding/api/admin-onboardings')>();

  return {
    ...actual,
    fetchAdminOnboardings: vi.fn(),
  };
});

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);

const DEFAULT_FILTERS: AdminOnboardingFilters = createDefaultAdminOnboardingFilters();

/** What the page requests for the default, unfiltered first page. */
const DEFAULT_REQUEST = { filters: DEFAULT_FILTERS, page: 1 };

const RECORD_ONE: AdminOnboardingSummary = {
  onboardingId: '018f1e2a-1111-7000-8000-000000000001',
  workflowId: 'kyc-basic',
  workflowVersion: 1,
  status: 'awaiting_user',
  currentStep: 'collect-documents',
  expiresAt: '2026-08-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  completedAt: null,
};

const RECORD_TWO: AdminOnboardingSummary = {
  onboardingId: '018f1e2a-2222-7000-8000-000000000002',
  workflowId: 'kyc-advanced',
  workflowVersion: 2,
  status: 'approved',
  currentStep: null,
  expiresAt: null,
  createdAt: 'not-a-real-date',
  updatedAt: '2026-07-03T00:00:00.000Z',
  completedAt: '2026-07-04T00:00:00.000Z',
};

function page(
  records: AdminOnboardingSummary[],
  overrides: Partial<AdminOnboardingsPageResult['pagination']> = {},
): AdminOnboardingsPageResult {
  return {
    records,
    pagination: {
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      total: records.length,
      totalPages: records.length > 0 ? 1 : 0,
      ...overrides,
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

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: false,
      },
    },
  });
}

function renderPage(queryClient?: QueryClient): ReturnType<typeof render> {
  const client = queryClient ?? createTestQueryClient();

  // Rows link to the details page, so the table needs a router context to render.
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AdminOnboardingsPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function renderReady(
  records: AdminOnboardingSummary[],
  paginationOverrides: Partial<AdminOnboardingsPageResult['pagination']> = {},
): Promise<void> {
  mockedFetchAdminOnboardings.mockResolvedValueOnce(page(records, paginationOverrides));
  renderPage();
  await waitFor(() => {
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });
  expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(1, DEFAULT_REQUEST);
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchAdminOnboardings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('AdminOnboardingsPage', () => {
  it('shows a loading status and disables controls while the initial request is pending', async () => {
    const { promise } = deferred<Awaited<ReturnType<typeof fetchAdminOnboardings>>>();
    mockedFetchAdminOnboardings.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings…');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Onboardings results' })).not.toBeInTheDocument();
  });

  it('issues exactly one request under StrictMode despite its development-only double effect invocation', async () => {
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));

    render(
      <StrictMode>
        <MemoryRouter>
          <QueryClientProvider client={createTestQueryClient()}>
            <AdminOnboardingsPage />
          </QueryClientProvider>
        </MemoryRouter>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing 1 of 1 onboardings (page 1 of 1).',
      );
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(1, DEFAULT_REQUEST);
  });

  it('links each row to the onboarding it lists, so an operator can open it', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('link', { name: RECORD_ONE.onboardingId })).toHaveAttribute(
      'href',
      `/onboardings/${RECORD_ONE.onboardingId}`,
    );
  });

  it('renders lifecycle-safe columns for populated rows, including invalid-date fallback', async () => {
    await renderReady([RECORD_ONE, RECORD_TWO]);

    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 onboardings (page 1 of 1).',
    );
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);
    expect(screen.getByText(RECORD_ONE.onboardingId)).toBeInTheDocument();
    expect(screen.getByText('collect-documents')).toBeInTheDocument();
    expect(screen.getAllByText('-').length).toBeGreaterThan(0);
    expect(screen.getByText('Invalid date')).toBeInTheDocument();
  });

  it('shows a successful-empty state when the engine returns no records', async () => {
    await renderReady([]);

    expect(screen.getByRole('status')).toHaveTextContent('No onboardings were returned.');
    expect(screen.getByRole('cell', { name: 'No onboardings were returned.' })).toBeInTheDocument();
  });

  it('shows a failure state when the request fails', async () => {
    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('request-failed', 'Failed to fetch'),
    );

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Failed to fetch',
      );
    });
    expect(screen.queryByRole('region', { name: 'Onboardings results' })).not.toBeInTheDocument();
  });

  it('keeps edits as draft only and does not fetch until Apply filters is submitted', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE, RECORD_TWO]);

    await user.type(screen.getByLabelText('Workflow ID'), 'does-not-exist');

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 onboardings (page 1 of 1).',
    );

    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'does-not-exist' },
      page: 1,
    });
    expect(screen.getByRole('status')).toHaveTextContent(
      'No onboardings match the current filters.',
    );
  });

  it('refetches the same applied key once on resubmission without showing stale rows while pending', async () => {
    const user = userEvent.setup();
    const initialRequest = deferred<Awaited<ReturnType<typeof fetchAdminOnboardings>>>();
    const resubmissionRequest = deferred<Awaited<ReturnType<typeof fetchAdminOnboardings>>>();

    mockedFetchAdminOnboardings.mockReturnValueOnce(initialRequest.promise);
    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings…');

    initialRequest.resolve(page([RECORD_ONE]));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing 1 of 1 onboardings (page 1 of 1).',
      );
    });

    await user.type(screen.getByLabelText('Workflow ID'), 'kyc-basic');
    mockedFetchAdminOnboardings.mockReturnValueOnce(resubmissionRequest.promise);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings…');
    expect(screen.queryByText(RECORD_ONE.onboardingId)).not.toBeInTheDocument();

    resubmissionRequest.resolve(page([RECORD_ONE]));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing 1 of 1 onboardings (page 1 of 1).',
      );
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
  });

  it('does not submit invalid workflow version and keeps previously applied results', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    const versionInput = screen.getByLabelText('Workflow version');
    await user.type(versionInput, 'abc');
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(versionInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Enter a whole number greater than zero.', {
        selector: '#workflow-version-error',
      }),
    ).toBeVisible();
    expect(screen.getByText(RECORD_ONE.onboardingId)).toBeInTheDocument();
  });

  it('shows the fetch error state when the request rejects with an invalid-input reason', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    await user.type(screen.getByLabelText('Workflow ID'), 'kyc-basic');
    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('invalid-input', 'Enter a whole number greater than zero.'),
    );
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Enter a whole number greater than zero.',
      );
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
    expect(screen.queryByRole('region', { name: 'Onboardings results' })).not.toBeInTheDocument();
  });

  it('repeats the applied query when Reload is activated after errors and payload failures', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);
    await user.type(screen.getByLabelText('Workflow ID'), 'kyc-basic');

    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('request-failed', 'Request failed with status 500.', 500),
    );
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Request failed with status 500.',
      );
    });

    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('request-failed', 'Failed to fetch'),
    );
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Failed to fetch',
      );
    });

    mockedFetchAdminOnboardings.mockRejectedValueOnce(
      new AdminOnboardingsFetchError('invalid-payload', 'Response payload is not an array.'),
    );
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Response payload is not an array.',
      );
    });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE, RECORD_TWO]));
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(5);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(3, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(4, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(5, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
  });

  it('trims submitted values before applying and requesting filters', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    await user.type(screen.getByLabelText('Workflow ID'), '  kyc-basic  ');
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: { ...DEFAULT_FILTERS, workflowId: 'kyc-basic' },
      page: 1,
    });
  });

  it('clears draft and applied filters via Reset filters and fetches unfiltered exactly once', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE, RECORD_TWO]);

    const workflowIdInput = screen.getByLabelText('Workflow ID');
    await user.type(workflowIdInput, 'kyc-basic');
    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(page([RECORD_ONE, RECORD_TWO]));
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(3, DEFAULT_REQUEST);
    expect(workflowIdInput).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Showing 2 of 2 onboardings (page 1 of 1).',
    );
  });

  it('renders the pager inert when the endpoint reports a single page', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('navigation', { name: 'Onboarding pages' })).toHaveTextContent('of 1');
    expect(screen.getByLabelText('Page')).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('hides the pager when nothing matched, since there is no page to step to', async () => {
    await renderReady([]);

    expect(screen.queryByRole('navigation', { name: 'Onboarding pages' })).not.toBeInTheDocument();
  });

  it('steps to the next page through the pager and reports the new window', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    const pager = screen.getByRole('navigation', { name: 'Onboarding pages' });
    expect(pager).toHaveTextContent('of 3');
    expect(screen.getByLabelText('Page')).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();

    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_TWO], { page: 2, total: 41, totalPages: 3 }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: DEFAULT_FILTERS,
      page: 2,
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing 1 of 41 onboardings (page 2 of 3).',
      );
    });
    expect(screen.getByLabelText('Page')).toHaveValue('2');
  });

  it('jumps straight to the page the operator names, keeping the applied criteria', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_TWO], { page: 3, total: 41, totalPages: 3 }),
    );
    const pageInput = screen.getByLabelText('Page');
    await user.clear(pageInput);
    await user.type(pageInput, '3{Enter}');

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: DEFAULT_FILTERS,
      page: 3,
    });
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Showing 1 of 41 onboardings (page 3 of 3).',
      );
    });
  });

  it('lands on the last page when the operator names one past the end', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_TWO], { page: 3, total: 41, totalPages: 3 }),
    );
    const pageInput = screen.getByLabelText('Page');
    await user.clear(pageInput);
    await user.type(pageInput, '99{Enter}');

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: DEFAULT_FILTERS,
      page: 3,
    });
  });

  it('does not request anything for a typed page that names none, and restores the current one', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    const pageInput = screen.getByLabelText('Page');
    await user.clear(pageInput);
    await user.type(pageInput, 'abc{Enter}');

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(pageInput).toHaveValue('1');
  });

  it('disables Next on the last page so the operator cannot step past the end', async () => {
    await renderReady([RECORD_ONE], { page: 3, total: 41, totalPages: 3 });

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  });

  it('requests the selected page size and returns to the first page', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_ONE], { page: 2, total: 41, totalPages: 3 }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });

    await user.selectOptions(screen.getByLabelText('Per page'), '50');
    mockedFetchAdminOnboardings.mockResolvedValueOnce(
      page([RECORD_ONE], { limit: 50, total: 41, totalPages: 1 }),
    );
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(3, {
      filters: { ...DEFAULT_FILTERS, limit: 50 },
      page: 1,
    });
  });

  it('exposes accessible form, live region, and table semantics', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('form', { name: 'Filter onboardings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Onboardings results' })).toBeInTheDocument();
  });
});
