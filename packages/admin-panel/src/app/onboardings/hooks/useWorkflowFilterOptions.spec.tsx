import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAdminWorkflows,
  type AdminWorkflowsPage,
  type AdminWorkflowSummary,
} from '@/api/workflows/admin-workflows';
import { fetchWorkflowVersions, type WorkflowVersion } from '@/api/workflows/workflow-versions';
import { useWorkflowFilterOptions } from './useWorkflowFilterOptions';

vi.mock('@/api/workflows/admin-workflows', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/admin-workflows')>();
  return { ...actual, fetchAdminWorkflows: vi.fn() };
});

vi.mock('@/api/workflows/workflow-versions', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/workflows/workflow-versions')>();
  return { ...actual, fetchWorkflowVersions: vi.fn() };
});

const mockedFetchWorkflows = vi.mocked(fetchAdminWorkflows);
const mockedFetchVersions = vi.mocked(fetchWorkflowVersions);

function summary(overrides: Partial<AdminWorkflowSummary>): AdminWorkflowSummary {
  return {
    workflowId: 'kyc-basic',
    name: 'KYC basic',
    scope: 'users',
    servingVersion: 1,
    versionCount: 1,
    draftCount: 0,
    inProgressCount: 0,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
    ...overrides,
  };
}

function page(records: AdminWorkflowSummary[]): AdminWorkflowsPage {
  return {
    records,
    pagination: { page: 1, limit: 20, total: records.length, totalPages: 1 },
  };
}

function version(number: number, status: WorkflowVersion['status']): WorkflowVersion {
  return {
    version: number,
    status,
    createdAt: '2026-07-01T00:00:00.000Z',
    updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('useWorkflowFilterOptions', () => {
  it('leaves out families that have only drafts', async () => {
    mockedFetchWorkflows.mockResolvedValue(
      page([
        summary({ workflowId: 'kyc-basic' }),
        summary({ workflowId: 'draft-only', name: null, versionCount: 2, draftCount: 2 }),
      ]),
    );

    const { result } = renderHook(() => useWorkflowFilterOptions('', ''), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0]).toEqual({
      value: 'kyc-basic',
      label: 'KYC basic',
      description: 'kyc-basic · users',
    });
    expect(result.current.selectedItem).toBeNull();
    expect(result.current.inputValue).toBe('');
  });

  it('resolves a preselected id to its name', async () => {
    mockedFetchWorkflows.mockResolvedValue(page([summary({})]));

    const { result } = renderHook(() => useWorkflowFilterOptions('kyc-basic', ''), { wrapper });

    await waitFor(() => expect(result.current.selectedItem?.label).toBe('KYC basic'));
    expect(result.current.inputValue).toBe('KYC basic');
  });

  it('looks up an id the loaded pages do not hold', async () => {
    mockedFetchWorkflows.mockImplementation((filters) =>
      Promise.resolve(
        filters.search === 'far-away'
          ? page([summary({ workflowId: 'far-away', name: 'Far away' })])
          : page([summary({})]),
      ),
    );

    const { result } = renderHook(() => useWorkflowFilterOptions('far-away', ''), { wrapper });

    await waitFor(() => expect(result.current.selectedItem?.label).toBe('Far away'));
  });

  it('shows an unknown id as its raw id', async () => {
    mockedFetchWorkflows.mockResolvedValue(page([summary({})]));

    const { result } = renderHook(() => useWorkflowFilterOptions('ghost', ''), { wrapper });

    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.selectedItem).toEqual({ value: 'ghost', label: 'ghost' });
  });

  it('lists non-draft versions, retired included, and skips the request without a workflow', async () => {
    mockedFetchWorkflows.mockResolvedValue(page([summary({})]));
    mockedFetchVersions.mockResolvedValue([
      version(3, 'draft'),
      version(2, 'published'),
      version(1, 'retired'),
    ]);

    const empty = renderHook(() => useWorkflowFilterOptions('', ''), { wrapper });
    await waitFor(() => expect(empty.result.current.items).toHaveLength(1));
    expect(mockedFetchVersions).not.toHaveBeenCalled();
    expect(empty.result.current.versionOptions).toEqual([]);
    expect(empty.result.current.versionsLoading).toBe(false);

    const picked = renderHook(() => useWorkflowFilterOptions('kyc-basic', ''), { wrapper });
    await waitFor(() => expect(picked.result.current.versionOptions).toHaveLength(2));
    expect(picked.result.current.versionOptions).toEqual([
      { value: '2', label: 'v2 — published' },
      { value: '1', label: 'v1 — retired' },
    ]);
    expect(mockedFetchVersions).toHaveBeenCalledWith('kyc-basic');
  });

  it('shows a version the list does not hold as v<n>, with or without a workflow', async () => {
    mockedFetchWorkflows.mockResolvedValue(page([summary({})]));
    mockedFetchVersions.mockResolvedValue([version(2, 'published')]);

    const versionOnly = renderHook(() => useWorkflowFilterOptions('', '7'), { wrapper });
    await waitFor(() => expect(versionOnly.result.current.items).toHaveLength(1));
    expect(versionOnly.result.current.versionOptions).toEqual([{ value: '7', label: 'v7' }]);

    const unlisted = renderHook(() => useWorkflowFilterOptions('kyc-basic', '9'), { wrapper });
    await waitFor(() => expect(unlisted.result.current.versionOptions).toHaveLength(2));
    expect(unlisted.result.current.versionOptions).toEqual([
      { value: '2', label: 'v2 — published' },
      { value: '9', label: 'v9' },
    ]);

    const listed = renderHook(() => useWorkflowFilterOptions('kyc-basic', '2'), { wrapper });
    await waitFor(() =>
      expect(listed.result.current.versionOptions).toEqual([
        { value: '2', label: 'v2 — published' },
      ]),
    );
  });

  it('keeps the picked item while its id is the workflow, even when no list holds it', async () => {
    mockedFetchWorkflows.mockResolvedValue(page([summary({})]));
    const picked = { value: 'elsewhere', label: 'Elsewhere', description: 'elsewhere · users' };

    const { result } = renderHook(() => useWorkflowFilterOptions('elsewhere', ''), { wrapper });
    await waitFor(() => expect(result.current.isSearching).toBe(false));
    expect(result.current.selectedItem).toEqual({ value: 'elsewhere', label: 'elsewhere' });

    act(() => result.current.pick(picked));

    expect(result.current.selectedItem).toEqual(picked);
  });

  it('flags a failed list', async () => {
    mockedFetchWorkflows.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useWorkflowFilterOptions('', ''), { wrapper });

    await waitFor(() => expect(result.current.listFailed).toBe(true));
  });
});
