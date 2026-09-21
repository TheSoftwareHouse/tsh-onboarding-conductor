import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEncryption } from './useEncryption';
import {
  addEncryptionKey,
  EncryptionFetchError,
  EncryptionWriteError,
  fetchEncryptionState,
  setEncryptionEnabled,
} from '../api/admin-encryption';
import type { EncryptionKey, EncryptionState } from '../types/encryption';

vi.mock('../api/admin-encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-encryption')>();

  return {
    ...actual,
    fetchEncryptionState: vi.fn(),
    setEncryptionEnabled: vi.fn(),
    addEncryptionKey: vi.fn(),
  };
});

const mockedFetchEncryptionState = vi.mocked(fetchEncryptionState);
const mockedSetEncryptionEnabled = vi.mocked(setEncryptionEnabled);
const mockedAddEncryptionKey = vi.mocked(addEncryptionKey);

function createKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    createdAt: '2026-09-17T09:00:36.572Z',
    createdBy: 'operator-oid',
    activatedAt: '2026-09-17T09:00:51.557Z',
    deletedAt: null,
    active: true,
    pendingActivation: false,
    ...overrides,
  };
}

function createState(overrides: Partial<EncryptionState> = {}): EncryptionState {
  return {
    enabled: true,
    keyConfigured: true,
    keys: [createKey()],
    progress: { pending: 0, total: 12 },
    ...overrides,
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
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

async function renderReady(
  state: EncryptionState = createState(),
): Promise<ReturnType<typeof renderHook<ReturnType<typeof useEncryption>, unknown>>> {
  mockedFetchEncryptionState.mockResolvedValueOnce(state);
  const rendered = renderHook(() => useEncryption(), { wrapper: createWrapper() });
  await waitFor(() => expect(rendered.result.current.phase).toBe('ready'));
  return rendered;
}

beforeEach(() => {
  mockedFetchEncryptionState.mockReset();
  mockedSetEncryptionEnabled.mockReset();
  mockedAddEncryptionKey.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEncryption', () => {
  it('reports loading then ready with the fetched state', async () => {
    const state = createState({ progress: { pending: 2, total: 5 } });
    mockedFetchEncryptionState.mockResolvedValueOnce(state);

    const { result } = renderHook(() => useEncryption(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('loading');
    expect(result.current.state).toBeNull();
    expect(result.current.pendingAction).toBeNull();

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.state).toEqual(state);
    expect(result.current.error).toBeNull();
  });

  it('reports the fetch error with no state', async () => {
    const fetchError = new EncryptionFetchError('request-failed', 'Failed to fetch', 500);
    mockedFetchEncryptionState.mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useEncryption(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });
    expect(result.current.state).toBeNull();
    expect(result.current.error).toBe(fetchError);
  });

  it('refetches on demand, exactly once per call', async () => {
    const { result } = await renderReady();
    mockedFetchEncryptionState.mockResolvedValueOnce(
      createState({ progress: { pending: 1, total: 12 } }),
    );

    act(() => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.state?.progress).toEqual({ pending: 1, total: 12 });
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
  });

  it('seeds the state a successful toggle answers with, then refetches exactly once', async () => {
    const { result } = await renderReady(createState({ enabled: false, keys: [] }));

    const pendingKey = createKey({ active: false, pendingActivation: true });
    const toggledState = createState({ keys: [pendingKey], progress: { pending: 12, total: 12 } });
    const { promise: refetchPromise, resolve: resolveRefetch } = deferred<EncryptionState>();
    mockedSetEncryptionEnabled.mockResolvedValueOnce(toggledState);
    mockedFetchEncryptionState.mockReturnValueOnce(refetchPromise);

    let outcome;
    await act(async () => {
      outcome = await result.current.setEnabled(true);
    });

    expect(outcome).toEqual({ ok: true, state: toggledState });
    expect(mockedSetEncryptionEnabled).toHaveBeenCalledWith(true);
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
    // The PATCH's own answer is on screen while the refetch is still unresolved.
    await waitFor(() => {
      expect(result.current.state).toEqual(toggledState);
    });

    const settledState = createState({ keys: [createKey()], progress: { pending: 9, total: 12 } });
    resolveRefetch(settledState);
    await waitFor(() => {
      expect(result.current.state).toEqual(settledState);
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
  });

  it('reports a refused toggle without touching the cached state or refetching', async () => {
    const initial = createState({ enabled: false, keys: [], keyConfigured: false });
    const { result } = await renderReady(initial);

    const writeError = new EncryptionWriteError(
      'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
      503,
      'ENCRYPTION_KEY_NOT_CONFIGURED',
    );
    mockedSetEncryptionEnabled.mockRejectedValueOnce(writeError);

    let outcome;
    await act(async () => {
      outcome = await result.current.setEnabled(true);
    });

    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });
    expect(result.current.state).toEqual(initial);
  });

  it('refetches the state after a successful add, exactly once', async () => {
    const { result } = await renderReady();

    mockedAddEncryptionKey.mockResolvedValueOnce('new-key-id');
    const rotatedState = createState({
      keys: [createKey({ id: 'new-key-id', active: false, pendingActivation: true }), createKey()],
      progress: { pending: 12, total: 12 },
    });
    mockedFetchEncryptionState.mockResolvedValueOnce(rotatedState);

    let outcome;
    await act(async () => {
      outcome = await result.current.addKey();
    });

    expect(outcome).toEqual({ ok: true, id: 'new-key-id' });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(result.current.state).toEqual(rotatedState);
    });
  });

  it('reports a refused add without refetching', async () => {
    const { result } = await renderReady();

    const writeError = new EncryptionWriteError(
      'Encryption is turned off, so there is no key to rotate.',
      409,
      'ENCRYPTION_DISABLED',
    );
    mockedAddEncryptionKey.mockRejectedValueOnce(writeError);

    let outcome;
    await act(async () => {
      outcome = await result.current.addKey();
    });

    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });
  });

  it('wraps a rejection that is not a write error, so the page always has a message', async () => {
    const { result } = await renderReady();
    mockedAddEncryptionKey.mockRejectedValueOnce(new TypeError('boom'));

    let outcome: Awaited<ReturnType<typeof result.current.addKey>> | undefined;
    await act(async () => {
      outcome = await result.current.addKey();
    });

    expect(outcome?.ok).toBe(false);
    expect(outcome && !outcome.ok ? outcome.error : null).toBeInstanceOf(EncryptionWriteError);
    expect(outcome && !outcome.ok ? outcome.error.message : null).toBe('Request failed.');
  });

  it('names the write in flight through pendingAction, and clears it when the write settles', async () => {
    const { result } = await renderReady();

    const { promise: togglePromise, resolve: resolveToggle } = deferred<EncryptionState>();
    mockedSetEncryptionEnabled.mockReturnValueOnce(togglePromise);
    mockedFetchEncryptionState.mockResolvedValueOnce(createState({ enabled: false }));

    let outcomePromise: Promise<unknown> | undefined;
    act(() => {
      outcomePromise = result.current.setEnabled(false);
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBe('toggle');
    });

    resolveToggle(createState({ enabled: false }));
    await act(async () => {
      await outcomePromise;
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });

    const { promise: addPromise, resolve: resolveAdd } = deferred<string>();
    mockedAddEncryptionKey.mockReturnValueOnce(addPromise);
    mockedFetchEncryptionState.mockResolvedValueOnce(createState());

    act(() => {
      outcomePromise = result.current.addKey();
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBe('add-key');
    });

    resolveAdd('new-key-id');
    await act(async () => {
      await outcomePromise;
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });
  });
});
