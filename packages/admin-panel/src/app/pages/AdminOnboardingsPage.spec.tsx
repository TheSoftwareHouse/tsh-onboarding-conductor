import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminOnboardingsPage } from './AdminOnboardingsPage';
import {
  AdminOnboardingsFetchError,
  fetchAdminOnboardings,
} from '@/features/onboarding/api/admin-onboardings';
import type { AdminOnboardingFilters, AdminOnboardingSummary } from '@/features/onboarding';

vi.mock('@/features/onboarding/api/admin-onboardings', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/features/onboarding/api/admin-onboardings')>();

  return {
    ...actual,
    fetchAdminOnboardings: vi.fn(),
  };
});

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);

const DEFAULT_FILTERS: AdminOnboardingFilters = {
  status: '',
  workflowId: '',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
};

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

  return render(
    <QueryClientProvider client={client}>
      <AdminOnboardingsPage />
    </QueryClientProvider>,
  );
}

async function renderReady(records: AdminOnboardingSummary[]): Promise<void> {
  mockedFetchAdminOnboardings.mockResolvedValueOnce(records);
  renderPage();
  await waitFor(() => {
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });
  expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(1, { filters: DEFAULT_FILTERS });
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
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);

    render(
      <StrictMode>
        <QueryClientProvider client={createTestQueryClient()}>
          <AdminOnboardingsPage />
        </QueryClientProvider>
      </StrictMode>,
    );

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 1 onboardings.');
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(1, { filters: DEFAULT_FILTERS });
  });

  it('renders lifecycle-safe columns for populated rows, including invalid-date fallback', async () => {
    await renderReady([RECORD_ONE, RECORD_TWO]);

    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 onboardings.');
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
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 onboardings.');

    mockedFetchAdminOnboardings.mockResolvedValueOnce([]);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'does-not-exist',
      },
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

    initialRequest.resolve([RECORD_ONE]);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 1 onboardings.');
    });

    await user.type(screen.getByLabelText('Workflow ID'), 'kyc-basic');
    mockedFetchAdminOnboardings.mockReturnValueOnce(resubmissionRequest.promise);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings…');
    expect(screen.queryByText(RECORD_ONE.onboardingId)).not.toBeInTheDocument();

    resubmissionRequest.resolve([RECORD_ONE]);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 1 onboardings.');
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
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
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
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

    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE, RECORD_TWO]);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(5);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(3, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(4, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(5, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
    });
  });

  it('trims submitted values before applying and requesting filters', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    await user.type(screen.getByLabelText('Workflow ID'), '  kyc-basic  ');
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2, {
      filters: {
        ...DEFAULT_FILTERS,
        workflowId: 'kyc-basic',
      },
    });
  });

  it('clears draft and applied filters via Reset filters and fetches unfiltered exactly once', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE, RECORD_TWO]);

    const workflowIdInput = screen.getByLabelText('Workflow ID');
    await user.type(workflowIdInput, 'kyc-basic');
    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE]);
    await user.click(screen.getByRole('button', { name: 'Apply filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });

    mockedFetchAdminOnboardings.mockResolvedValueOnce([RECORD_ONE, RECORD_TWO]);
    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(3);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(3, { filters: DEFAULT_FILTERS });
    expect(workflowIdInput).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 onboardings.');
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
