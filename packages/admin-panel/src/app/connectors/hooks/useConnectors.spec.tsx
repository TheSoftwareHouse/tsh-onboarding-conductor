import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectors } from './useConnectors';
import {
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
  type Connector,
} from '@/api/connectors/connectors';
import { ApiError } from '@/services/api/api-error';
import { createQueryClient } from '@/services/query-client/create-query-client';

vi.mock('@/api/connectors/connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/connectors/connectors')>();

  return {
    ...actual,
    fetchConnectors: vi.fn(),
    patchConnectorSettings: vi.fn(),
    deleteConnectorSettings: vi.fn(),
  };
});

const mockedFetchConnectors = vi.mocked(fetchConnectors);
const mockedPatchConnectorSettings = vi.mocked(patchConnectorSettings);
const mockedDeleteConnectorSettings = vi.mocked(deleteConnectorSettings);

function connector(overrides: Partial<Connector> = {}): Connector {
  return {
    id: 'smtp',
    type: 'email_delivery',
    name: 'SMTP',
    configured: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function createWrapper(): (props: { children: ReactNode }) => ReactElement {
  const client = createQueryClient();

  return ({ children }: { children: ReactNode }): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  mockedFetchConnectors.mockReset();
  mockedPatchConnectorSettings.mockReset();
  mockedDeleteConnectorSettings.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useConnectors', () => {
  it('reports pending then success with the fetched connectors', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);

    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });

    expect(result.current.isPending).toBe(true);
    expect(result.current.connectors).toEqual([]);

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });
    expect(result.current.connectors).toEqual([connector()]);
    expect(result.current.error).toBeNull();
  });

  it('reports the fetch error', async () => {
    const fetchError = new ApiError('Failed to fetch', { status: 500 });
    mockedFetchConnectors.mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.connectors).toEqual([]);
    expect(result.current.error).toBe(fetchError);
  });

  it('refetches the list after a successful save', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    mockedPatchConnectorSettings.mockResolvedValueOnce(connector({ configured: true }));
    mockedFetchConnectors.mockResolvedValueOnce([connector({ configured: true })]);

    let outcome: Awaited<ReturnType<typeof result.current.saveSettings>> | undefined;
    await act(async () => {
      outcome = await result.current.saveSettings('smtp', { 'smtp.username': 'ops' });
    });

    expect(outcome).toEqual({ ok: true });
    expect(mockedPatchConnectorSettings).toHaveBeenCalledWith('smtp', { 'smtp.username': 'ops' });
    await waitFor(() => {
      expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.connectors).toEqual([connector({ configured: true })]);
    });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
  });

  it('keeps the previously fetched connectors readable while a post-save refetch is in flight', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    mockedPatchConnectorSettings.mockResolvedValueOnce(connector({ configured: true }));
    let resolveRefetch: (value: Connector[]) => void = () => {};
    mockedFetchConnectors.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveRefetch = resolve;
      }),
    );

    let savePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      savePromise = result.current.saveSettings('smtp', { 'smtp.username': 'ops' });
    });

    // The save's own promise resolves as soon as the write succeeds, before the refetch it
    // kicks off has settled — at that point the query is fetching again but a page must not
    // treat that as "loading" and unmount every card, discarding the ones the operator did not
    // touch. So `isSuccess` stays true and the last-fetched list stays visible throughout.
    await waitFor(() => {
      expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
    });
    expect(result.current.isSuccess).toBe(true);
    expect(result.current.connectors).toEqual([connector()]);

    resolveRefetch([connector({ configured: true })]);
    await savePromise;
    await waitFor(() => {
      expect(result.current.connectors).toEqual([connector({ configured: true })]);
    });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
  });

  it('does not refetch after a failed save, and surfaces the write error', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const writeError = new ApiError('Rejected', {
      status: 400,
      code: 'CONNECTOR_SETTINGS_INVALID',
      body: {
        code: 'CONNECTOR_SETTINGS_INVALID',
        message: 'CONNECTOR_SETTINGS_INVALID',
        issues: [{ key: 'smtp.username', reason: 'missing_pairing' }],
      },
    });
    mockedPatchConnectorSettings.mockRejectedValueOnce(writeError);

    let outcome: Awaited<ReturnType<typeof result.current.saveSettings>> | undefined;
    await act(async () => {
      outcome = await result.current.saveSettings('smtp', {});
    });

    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });

  it('refetches the list after a successful clear', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector({ configured: true })]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    mockedDeleteConnectorSettings.mockResolvedValueOnce(undefined);
    mockedFetchConnectors.mockResolvedValueOnce([connector({ configured: false })]);

    let outcome: Awaited<ReturnType<typeof result.current.clearSettings>> | undefined;
    await act(async () => {
      outcome = await result.current.clearSettings('smtp');
    });

    expect(outcome).toEqual({ ok: true });
    expect(mockedDeleteConnectorSettings).toHaveBeenCalledWith('smtp');
    await waitFor(() => {
      expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(result.current.connectors).toEqual([connector({ configured: false })]);
    });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
  });

  it('does not refetch after a failed clear, and surfaces the write error', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector({ configured: true })]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const writeError = new ApiError('Server unavailable', { status: 503 });
    mockedDeleteConnectorSettings.mockRejectedValueOnce(writeError);

    let outcome: Awaited<ReturnType<typeof result.current.clearSettings>> | undefined;
    await act(async () => {
      outcome = await result.current.clearSettings('smtp');
    });

    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });
});
