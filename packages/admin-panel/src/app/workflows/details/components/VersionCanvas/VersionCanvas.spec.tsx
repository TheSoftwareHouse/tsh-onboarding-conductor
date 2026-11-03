import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWorkflowDocument } from '@/api/workflows/workflow-drafts';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { VersionCanvas } from './VersionCanvas';

vi.mock('@/api/workflows/workflow-drafts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-drafts')>();
  return { ...actual, fetchWorkflowDocument: vi.fn() };
});

const mockedFetch = vi.mocked(fetchWorkflowDocument);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function stored(document: Record<string, unknown>) {
  return {
    workflowId: 'kyc',
    version: 2,
    status: 'published' as const,
    name: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    document,
  };
}

function renderCanvas(): void {
  render(
    <QueryClientProvider client={createQueryClient()}>
      <VersionCanvas workflowId="kyc" version={2} />
    </QueryClientProvider>,
  );
}

describe('VersionCanvas', () => {
  it('draws the stored document without the palette', async () => {
    mockedFetch.mockResolvedValue(
      stored({ steps: [{ name: 'done', type: 'terminal', config: { outcome: 'approved' } }] }),
    );
    renderCanvas();

    expect(await screen.findByText('1 step · 0 edges')).toBeInTheDocument();
    expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('kyc', 2);
  });

  it('offers a Retry when the document cannot be read', async () => {
    mockedFetch.mockRejectedValue(new ApiError('Request failed with status 500.', { status: 500 }));
    renderCanvas();

    expect(await screen.findByText(/Unable to load the document/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('says so when the stored document has no steps array', async () => {
    mockedFetch.mockResolvedValue(stored({ id: 'kyc' }));
    renderCanvas();

    expect(await screen.findByText(/Unable to draw this version/)).toBeInTheDocument();
  });
});
