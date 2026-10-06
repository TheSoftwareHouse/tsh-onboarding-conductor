import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AdminOnboardingsExportError,
  fetchAdminOnboardingsCsv,
} from '@/api/onboardings/onboardings-export';
import { showErrorToast } from '@/components/ui/Toast/toast-manager';
import { downloadFile } from '@/lib/download-file';
import { useOnboardingsExport } from './useOnboardingsExport';

vi.mock('@/api/onboardings/onboardings-export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/onboardings/onboardings-export')>();

  return { ...actual, fetchAdminOnboardingsCsv: vi.fn() };
});

vi.mock('@/lib/download-file', () => ({ downloadFile: vi.fn() }));

vi.mock('@/components/ui/Toast/toast-manager', () => ({ showErrorToast: vi.fn() }));

const mockedFetchCsv = vi.mocked(fetchAdminOnboardingsCsv);
const mockedDownloadFile = vi.mocked(downloadFile);
const mockedShowErrorToast = vi.mocked(showErrorToast);

const FILTERS = {
  status: 'approved',
  workflowId: null,
  workflowVersion: null,
  currentStep: null,
  onboardingId: null,
} as const;

function wrapper({ children }: { children: ReactNode }): ReactElement {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  mockedFetchCsv.mockReset();
  mockedDownloadFile.mockReset();
  mockedShowErrorToast.mockReset();
});

afterEach(() => {
  cleanup();
});

describe('useOnboardingsExport', () => {
  it('fetches with the given filters and saves the blob under a timestamped csv name', async () => {
    const blob = new Blob(['id']);
    mockedFetchCsv.mockResolvedValueOnce(blob);
    const { result } = renderHook(() => useOnboardingsExport(), { wrapper });

    act(() => {
      result.current.exportCsv(FILTERS);
    });

    await waitFor(() => {
      expect(mockedDownloadFile).toHaveBeenCalledTimes(1);
    });
    expect(mockedFetchCsv.mock.calls[0]?.[0]).toEqual(FILTERS);
    expect(mockedDownloadFile.mock.calls[0]?.[0]).toBe(blob);
    expect(mockedDownloadFile.mock.calls[0]?.[1]).toMatch(
      /^onboardings-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}\.csv$/,
    );
    expect(mockedShowErrorToast).not.toHaveBeenCalled();
  });

  it('reports pending while the request is in flight', async () => {
    let resolve!: (blob: Blob) => void;
    mockedFetchCsv.mockReturnValueOnce(
      new Promise<Blob>((res) => {
        resolve = res;
      }),
    );
    const { result } = renderHook(() => useOnboardingsExport(), { wrapper });

    act(() => {
      result.current.exportCsv(FILTERS);
    });
    await waitFor(() => {
      expect(result.current.pending).toBe(true);
    });

    resolve(new Blob(['id']));
    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
  });

  it('raises an error toast with the failure message and saves nothing', async () => {
    mockedFetchCsv.mockRejectedValueOnce(
      new AdminOnboardingsExportError('Request failed with status 500.', 500),
    );
    const { result } = renderHook(() => useOnboardingsExport(), { wrapper });

    act(() => {
      result.current.exportCsv(FILTERS);
    });

    await waitFor(() => {
      expect(mockedShowErrorToast).toHaveBeenCalledWith(
        'Export failed',
        'Request failed with status 500.',
      );
    });
    expect(mockedDownloadFile).not.toHaveBeenCalled();
  });
});
