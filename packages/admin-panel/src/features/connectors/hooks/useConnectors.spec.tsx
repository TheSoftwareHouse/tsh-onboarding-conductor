import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectors } from './useConnectors';
import {
  ConnectorsFetchError,
  ConnectorSettingsWriteError,
  deleteConnectorSettings,
  fetchConnectors,
  patchConnectorSettings,
} from '../api/admin-connectors';
import type { Connector } from '../types/connector';

vi.mock('../api/admin-connectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-connectors')>();

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
    allowAdditionalKeys: false,
    settings: [],
    updatedAt: null,
    updatedBy: null,
    ...overrides,
  };
}

function createWrapper(): (props: { children: ReactNode }) => ReactElement {
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
  it('reports loading then ready with the fetched connectors', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);

    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('loading');
    expect(result.current.connectors).toEqual([]);

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.connectors).toEqual([connector()]);
    expect(result.current.error).toBeNull();
  });

  it('reports the fetch error', async () => {
    const fetchError = new ConnectorsFetchError('request-failed', 'Failed to fetch', 500);
    mockedFetchConnectors.mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });
    expect(result.current.connectors).toEqual([]);
    expect(result.current.error).toBe(fetchError);
  });

  it('refetches the list after a successful save', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
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
  });

  it('keeps the previously fetched connectors readable while a post-save refetch is in flight', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
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
    // touch. So `phase` stays `ready` and the last-fetched list stays visible throughout.
    await waitFor(() => {
      expect(mockedFetchConnectors).toHaveBeenCalledTimes(2);
    });
    expect(result.current.phase).toBe('ready');
    expect(result.current.connectors).toEqual([connector()]);

    resolveRefetch([connector({ configured: true })]);
    await savePromise;
    await waitFor(() => {
      expect(result.current.connectors).toEqual([connector({ configured: true })]);
    });
  });

  it('does not refetch after a failed save, and surfaces the write error', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector()]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    const writeError = new ConnectorSettingsWriteError('Rejected', 400, [
      { key: 'smtp.username', reason: 'missing_pairing' },
    ]);
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
      expect(result.current.phase).toBe('ready');
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
  });

  it('does not refetch after a failed clear, and surfaces the write error', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([connector({ configured: true })]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    const writeError = new ConnectorSettingsWriteError('Server unavailable', 503);
    mockedDeleteConnectorSettings.mockRejectedValueOnce(writeError);

    let outcome: Awaited<ReturnType<typeof result.current.clearSettings>> | undefined;
    await act(async () => {
      outcome = await result.current.clearSettings('smtp');
    });

    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(mockedFetchConnectors).toHaveBeenCalledTimes(1);
  });

  it('leaves another connector not pending while one connector write is in flight', async () => {
    mockedFetchConnectors.mockResolvedValueOnce([
      connector({ id: 'smtp' }),
      connector({ id: 'sendgrid_email' }),
    ]);
    const { result } = renderHook(() => useConnectors(), { wrapper: createWrapper() });
    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });

    let resolveSave: (value: Connector) => void = () => {};
    mockedPatchConnectorSettings.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );

    let savePromise: Promise<unknown> = Promise.resolve();
    act(() => {
      savePromise = result.current.saveSettings('smtp', { 'smtp.username': 'ops' });
    });

    await waitFor(() => {
      expect(result.current.pendingConnectorId).toBe('smtp');
    });
    expect(result.current.pendingConnectorId).not.toBe('sendgrid_email');

    mockedFetchConnectors.mockResolvedValueOnce([
      connector({ id: 'smtp', configured: true }),
      connector({ id: 'sendgrid_email' }),
    ]);
    await act(async () => {
      resolveSave(connector({ id: 'smtp', configured: true }));
      await savePromise;
    });

    await waitFor(() => {
      expect(result.current.pendingConnectorId).toBeNull();
    });
  });
});
