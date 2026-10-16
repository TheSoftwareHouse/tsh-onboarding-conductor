import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { NuqsAdapter } from 'nuqs/adapters/react-router/v8';
import { BrowserRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/services/api/api-error';
import { WorkflowsPage } from './WorkflowsPage';
import { WORKFLOWS_PAGE_SIZE } from './utils/filter-admin-workflows';
import {
  fetchAdminWorkflows,
  type AdminWorkflowQueryFilters,
  type AdminWorkflowsPage as AdminWorkflowsPageResult,
  type AdminWorkflowSummary,
} from '@/api/workflows/admin-workflows';

vi.mock('@/api/workflows/admin-workflows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/admin-workflows')>();

  return {
    ...actual,
    fetchAdminWorkflows: vi.fn(),
  };
});

const mockedFetchAdminWorkflows = vi.mocked(fetchAdminWorkflows);

/** The normalized query filters a committed page carries, defaulting to an unfiltered first page. */
function defaultQueryFilters(
  overrides: Partial<AdminWorkflowQueryFilters> = {},
  page = 1,
): AdminWorkflowQueryFilters {
  return {
    page,
    limit: WORKFLOWS_PAGE_SIZE,
    search: null,
    scope: null,
    hasDraft: null,
    ...overrides,
  };
}

const DEFAULT_REQUEST = defaultQueryFilters();

const RECORD_ONE: AdminWorkflowSummary = {
  workflowId: 'eu-b2c-individual-kyc-eea',
  name: 'EU B2C individual KYC — EEA',
  scope: 'built-in',
  servingVersion: 1,
  versionCount: 3,
  draftCount: 1,
  inProgressCount: 68,
  createdAt: '2026-01-01T12:00:00.000Z',
  updatedAt: '2026-08-22T12:00:00.000Z',
};

const RECORD_TWO: AdminWorkflowSummary = {
  workflowId: 'ch-b2c-individual-kyc',
  name: null,
  scope: 'users',
  servingVersion: null,
  versionCount: 1,
  draftCount: 1,
  inProgressCount: 0,
  createdAt: '2026-09-18T12:00:00.000Z',
  updatedAt: '2026-09-18T12:00:00.000Z',
};

function page(
  records: AdminWorkflowSummary[],
  overrides: Partial<AdminWorkflowsPageResult['pagination']> = {},
): AdminWorkflowsPageResult {
  return {
    records,
    pagination: {
      page: 1,
      limit: WORKFLOWS_PAGE_SIZE,
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
  return createQueryClient();
}

function renderPage(
  queryClient?: QueryClient,
  initialPath = '/workflows',
): ReturnType<typeof render> {
  const client = queryClient ?? createTestQueryClient();

  // `BrowserRouter` shares `window.history` with the nuqs adapter, so seeding is one write.
  window.history.replaceState(null, '', initialPath);

  // Rows link to the details placeholder, so the page needs a router context.
  return render(
    <BrowserRouter>
      <NuqsAdapter>
        <QueryClientProvider client={client}>
          <WorkflowsPage eyebrow="Build" title="Workflows" />
        </QueryClientProvider>
      </NuqsAdapter>
    </BrowserRouter>,
  );
}

async function renderReady(
  records: AdminWorkflowSummary[],
  paginationOverrides: Partial<AdminWorkflowsPageResult['pagination']> = {},
): Promise<void> {
  mockedFetchAdminWorkflows.mockResolvedValueOnce(page(records, paginationOverrides));
  renderPage();
  await waitFor(() => {
    expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchAdminWorkflows.mockReset();
});

afterEach(() => {
  cleanup();
  delete window.__ENV__;
});

describe('WorkflowsPage', () => {
  it('shows a loading status and disables controls while the initial request is pending', async () => {
    const { promise } = deferred<Awaited<ReturnType<typeof fetchAdminWorkflows>>>();
    mockedFetchAdminWorkflows.mockReturnValueOnce(promise);

    renderPage();

    expect(screen.getByRole('status')).toHaveTextContent('Loading workflows…');
    expect(screen.getByRole('button', { name: 'Apply filters' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Workflows results' })).not.toBeInTheDocument();
  });

  it('renders the agreed columns and the id link for a row', async () => {
    await renderReady([RECORD_ONE]);

    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(1, DEFAULT_REQUEST);
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1–1 of 1 workflows.');
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);
    expect(screen.getByRole('link', { name: RECORD_ONE.workflowId })).toHaveAttribute(
      'href',
      `/workflows/${RECORD_ONE.workflowId}`,
    );
    expect(
      screen.queryByRole('link', { name: `Open workflow ${RECORD_ONE.workflowId}` }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(RECORD_ONE.name as string)).toBeInTheDocument();
    const table = within(screen.getByRole('table'));
    expect(table.getByText('built-in')).toBeInTheDocument();
    expect(table.getByText('v1')).toBeInTheDocument();
    expect(table.getByText('1 draft')).toBeInTheDocument();
    expect(table.getByText('1 Jan 2026')).toBeInTheDocument();
    expect(table.getByText('Edited 22 Aug 2026')).toBeInTheDocument();
  });

  it('links a non-zero In progress count to Onboardings filtered by workflowId', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('link', { name: '68' })).toHaveAttribute(
      'href',
      `/onboardings?workflowId=${RECORD_ONE.workflowId}`,
    );
  });

  it('shows a dash and "Not served" for a workflow with no serving version and no in-progress onboardings', async () => {
    await renderReady([RECORD_TWO]);

    expect(screen.getByText('Not served')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '0' })).not.toBeInTheDocument();
  });

  it('keeps edits as draft only and does not fetch until Apply filters is submitted', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    await user.type(screen.getByLabelText('Search'), 'does-not-exist');
    expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(1);

    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(
      2,
      defaultQueryFilters({ search: 'does-not-exist' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('No workflows match "does-not-exist".');
  });

  it('shows "No workflows match these filters." for a non-search criterion that narrows to nothing', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    await user.selectOptions(screen.getByLabelText('Scope'), 'fixtures');
    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(
      2,
      defaultQueryFilters({ scope: 'fixtures' }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('No workflows match these filters.');
  });

  it('shows "No workflows loaded." when nothing narrows an empty result', async () => {
    await renderReady([]);

    expect(screen.getByRole('status')).toHaveTextContent('No workflows loaded.');
  });

  it('shows "No workflows on this page." past the last page', async () => {
    mockedFetchAdminWorkflows.mockResolvedValueOnce(
      page([], { page: 99, total: 5, totalPages: 1 }),
    );
    renderPage(undefined, '/workflows?page=99');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('No workflows on this page.');
    });
  });

  it('clears draft and applied filters via Reset filters and fetches unfiltered exactly once', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    const searchInput = screen.getByLabelText('Search');
    await user.type(searchInput, 'eu-b2c');
    await user.click(screen.getByLabelText('Has unpublished draft'));
    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE]));
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(2);
    });

    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE, RECORD_TWO]));
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(3, DEFAULT_REQUEST);
    expect(searchInput).toHaveValue('');
    expect(screen.getByLabelText('Has unpublished draft')).not.toBeChecked();
  });

  it('steps to the next page through the pager and reports the new window', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE], { total: 41, totalPages: 3 });

    mockedFetchAdminWorkflows.mockResolvedValueOnce(
      page([RECORD_TWO], { page: 2, total: 41, totalPages: 3 }),
    );
    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(2, defaultQueryFilters({}, 2));
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 21–40 of 41 workflows.');
    });
  });

  it('shows a failure state when the request fails', async () => {
    mockedFetchAdminWorkflows.mockRejectedValueOnce(new ApiError('Failed to fetch'));

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load workflows: Failed to fetch',
      );
    });
    expect(screen.queryByRole('region', { name: 'Workflows results' })).not.toBeInTheDocument();
  });

  it('repeats the applied query when Reload is activated', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE, RECORD_TWO]));
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(2, DEFAULT_REQUEST);
  });

  it('restores the criteria the URL carries into both the controls and the request', async () => {
    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE]));
    renderPage(undefined, '/workflows?search=eea&scope=built-in&hasDraft=true&page=1');

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(1);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(
      1,
      defaultQueryFilters({ search: 'eea', scope: 'built-in', hasDraft: true }),
    );
    expect(screen.getByLabelText('Search')).toHaveValue('eea');
    expect(screen.getByLabelText('Search')).toHaveAttribute('maxlength', '100');
    expect(screen.getByLabelText('Scope')).toHaveValue('built-in');
    expect(screen.getByLabelText('Has unpublished draft')).toBeChecked();
  });

  it('treats ?hasDraft=false as no filter: 0 active and the unticked box', async () => {
    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE]));
    renderPage(undefined, '/workflows?hasDraft=false');

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(1);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(1, DEFAULT_REQUEST);
    expect(screen.getByLabelText('Has unpublished draft')).not.toBeChecked();
    expect(screen.queryByText(/active$/)).not.toBeInTheDocument();
  });

  it('offers every scope, fixtures included, when the engine is not in production', async () => {
    await renderReady([RECORD_ONE]);

    const scope = within(screen.getByLabelText('Scope'));
    expect(scope.getAllByRole('option').map((option) => option.textContent)).toEqual([
      'All',
      'built-in',
      'users',
      'fixtures',
    ]);
  });

  it('hides fixtures and ignores ?scope=fixtures when the engine runs in production', async () => {
    window.__ENV__ = { VITE_ENVIRONMENT_NAME: 'prod', VITE_NODE_ENV: 'production' };
    mockedFetchAdminWorkflows.mockResolvedValueOnce(page([RECORD_ONE]));
    renderPage(undefined, '/workflows?scope=fixtures');

    await waitFor(() => {
      expect(mockedFetchAdminWorkflows).toHaveBeenCalledTimes(1);
    });
    expect(mockedFetchAdminWorkflows).toHaveBeenNthCalledWith(1, DEFAULT_REQUEST);
    const scope = within(screen.getByLabelText('Scope'));
    expect(scope.queryByRole('option', { name: 'fixtures' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Scope')).toHaveValue('');
  });

  it('exposes accessible form, live region, and table semantics', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('form', { name: 'Filter workflows' })).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Workflows results' })).toBeInTheDocument();
  });

  it('has no planned-feature banner and offers a New draft button', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.queryByText(/Creating and editing here is planned/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New draft' })).toBeInTheDocument();
  });
});
