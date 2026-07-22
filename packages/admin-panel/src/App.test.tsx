import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { fetchAdminOnboardings } from './api/admin-onboardings';
import type { AdminOnboardingSummary } from './types/admin-onboarding';

vi.mock('./api/admin-onboardings', () => ({
  fetchAdminOnboardings: vi.fn(),
}));

const mockedFetchAdminOnboardings = vi.mocked(fetchAdminOnboardings);

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

async function renderReady(records: AdminOnboardingSummary[]): Promise<void> {
  mockedFetchAdminOnboardings.mockResolvedValueOnce({ ok: true, data: records });
  render(<App />);
  await waitFor(() => {
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });
  await screen.findByRole('status');
}

beforeEach(() => {
  mockedFetchAdminOnboardings.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('App', () => {
  it('shows a loading status and disables controls while the initial request is pending', async () => {
    const { promise } = deferred<Awaited<ReturnType<typeof fetchAdminOnboardings>>>();
    mockedFetchAdminOnboardings.mockReturnValueOnce(promise);

    render(<App />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading onboardings\u2026');
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Reset filters' })).toBeDisabled();
    expect(screen.queryByRole('region', { name: 'Onboardings results' })).not.toBeInTheDocument();
  });

  it('renders lifecycle-safe columns for populated rows, including invalid-date fallback', async () => {
    await renderReady([RECORD_ONE, RECORD_TWO]);

    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 onboardings.');

    const table = screen.getByRole('region', { name: 'Onboardings results' });
    expect(table).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(9);

    const rows = screen.getAllByRole('row');
    // header row + two data rows
    expect(rows).toHaveLength(3);

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
    mockedFetchAdminOnboardings.mockResolvedValueOnce({
      ok: false,
      error: { reason: 'network-error', message: 'Failed to fetch' },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(
        'Unable to load onboardings: Failed to fetch',
      );
    });
    expect(screen.queryByRole('region', { name: 'Onboardings results' })).not.toBeInTheDocument();
  });

  it('filters the loaded list locally without issuing a new request and supports filtered-empty state', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE, RECORD_TWO]);

    await user.type(screen.getByLabelText('Workflow ID'), 'does-not-exist');

    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'No onboardings match the current filters.',
    );
    expect(
      screen.getByRole('cell', { name: 'No onboardings match the current filters.' }),
    ).toBeInTheDocument();
  });

  it('shows invalid workflow-version feedback without filtering to a request', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    const versionInput = screen.getByLabelText('Workflow version');
    await user.type(versionInput, 'abc');

    expect(versionInput).toHaveAttribute('aria-invalid', 'true');
    expect(
      screen.getByText('Enter a whole number greater than zero.', {
        selector: '#workflow-version-error',
      }),
    ).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Enter a whole number greater than zero.');
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });

  it('repeats the unfiltered request when Reload is activated', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE]);

    mockedFetchAdminOnboardings.mockResolvedValueOnce({ ok: true, data: [RECORD_ONE, RECORD_TWO] });
    await user.click(screen.getByRole('button', { name: 'Reload' }));

    await waitFor(() => {
      expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(2);
    });
    expect(mockedFetchAdminOnboardings).toHaveBeenNthCalledWith(2);
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 onboardings.');
    });
  });

  it('resets filters to defaults without issuing a new request', async () => {
    const user = userEvent.setup();
    await renderReady([RECORD_ONE, RECORD_TWO]);

    const workflowIdInput = screen.getByLabelText('Workflow ID');
    await user.type(workflowIdInput, 'kyc-basic');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2 onboardings.');

    await user.click(screen.getByRole('button', { name: 'Reset filters' }));

    expect(workflowIdInput).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 of 2 onboardings.');
    expect(mockedFetchAdminOnboardings).toHaveBeenCalledTimes(1);
  });

  it('exposes accessible form, live region, and table semantics', async () => {
    await renderReady([RECORD_ONE]);

    expect(screen.getByRole('form', { name: 'Filter onboardings' })).toBeInTheDocument();
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Onboardings results' })).toBeInTheDocument();
  });
});
