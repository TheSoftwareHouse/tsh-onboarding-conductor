import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowDocument } from '@/api/workflows/workflow-drafts';
import { showErrorToast, showSuccessToast } from '@/components/ui/Toast/toast-manager';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { VersionDocument } from './VersionDocument';

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return { ...actual, fetchWorkflowDocument: vi.fn() };
});

vi.mock('@/components/ui/Toast/toast-manager', () => ({
  showSuccessToast: vi.fn(),
  showErrorToast: vi.fn(),
}));

vi.mock('../JsonEditor', () => ({
  JsonEditor: ({ value, label }: { value: string; label: string }) => (
    <textarea aria-label={label} value={value} readOnly />
  ),
}));

const mockedFetch = vi.mocked(fetchWorkflowDocument);

const DOCUMENT = { id: 'kyc', version: 2, steps: [] };
const TEXT = JSON.stringify(DOCUMENT, null, 2);

function stored() {
  return {
    workflowId: 'kyc',
    version: 2,
    status: 'published' as const,
    name: 'KYC flow',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    document: DOCUMENT,
  };
}

function stubClipboard(writeText: () => Promise<void>): void {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
}

function renderDocument(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VersionDocument workflowId="kyc" version={2} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe('VersionDocument', () => {
  it('fetches the document only once it mounts, and shows the formatted text read-only', async () => {
    mockedFetch.mockResolvedValue(stored());
    expect(mockedFetch).not.toHaveBeenCalled();

    renderDocument();

    expect(screen.getByText('Loading document…')).toBeInTheDocument();
    const editor = await screen.findByRole('textbox', {
      name: 'Workflow document (JSON, read-only)',
    });
    expect(editor).toHaveValue(TEXT);
    expect(mockedFetch).toHaveBeenCalledWith('kyc', 2);
  });

  it('copies the text and shows the success toast', async () => {
    mockedFetch.mockResolvedValue(stored());
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    renderDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Copy JSON' }));

    expect(writeText).toHaveBeenCalledWith(TEXT);
    await waitFor(() => expect(showSuccessToast).toHaveBeenCalledWith('JSON copied.'));
  });

  it('shows the error toast when the clipboard rejects', async () => {
    mockedFetch.mockResolvedValue(stored());
    const writeText = vi.fn().mockRejectedValue(new Error('denied'));
    stubClipboard(writeText);
    renderDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Copy JSON' }));

    await waitFor(() =>
      expect(showErrorToast).toHaveBeenCalledWith('Unable to copy the JSON:', 'denied'),
    );
  });

  it('shows the error toast when the clipboard is unavailable', async () => {
    mockedFetch.mockResolvedValue(stored());
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
    renderDocument();

    await userEvent.click(await screen.findByRole('button', { name: 'Copy JSON' }));

    expect(showErrorToast).toHaveBeenCalledWith(
      'Unable to copy the JSON:',
      'The clipboard is unavailable.',
    );
  });

  it('shows the failure with a Retry when the fetch fails', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiError('boom', { status: 500 }));
    mockedFetch.mockResolvedValue(stored());
    renderDocument();

    expect(await screen.findByText(/Unable to load the document: boom/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(
      await screen.findByRole('textbox', { name: 'Workflow document (JSON, read-only)' }),
    ).toHaveValue(TEXT);
  });
});
