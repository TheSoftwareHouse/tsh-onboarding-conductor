import type { ReactElement, ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/services/query-client/create-query-client';
import { act, renderHook, waitFor } from '@testing-library/react';
import { ApiError } from '@/services/api/api-error';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHANGE_IN_FLIGHT_POLL_INTERVAL_MS, useEncryption } from './useEncryption';
import {
  addEncryptionKey,
  fetchEncryptionState,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
  type EncryptionKey,
  type EncryptionState,
} from '@/api/encryption/admin-encryption';

vi.mock('@/api/encryption/admin-encryption', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/encryption/admin-encryption')>();

  return {
    ...actual,
    fetchEncryptionState: vi.fn(),
    setEncryptionEnabled: vi.fn(),
    setEncryptionRotationInterval: vi.fn(),
    addEncryptionKey: vi.fn(),
  };
});

const mockedFetchEncryptionState = vi.mocked(fetchEncryptionState);
const mockedSetEncryptionEnabled = vi.mocked(setEncryptionEnabled);
const mockedSetEncryptionRotationInterval = vi.mocked(setEncryptionRotationInterval);
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
    rotation: { interval: '1w', nextRotationAt: '2026-09-24T09:00:36.572Z' },
    progress: { pending: 0, total: 12 },
    reencrypting: false,
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
  const client = createQueryClient();

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
    const fetchError = new ApiError('Failed to fetch', { status: 500 });
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

  it('shows the state a successful toggle answers with at once, without a separate refetch', async () => {
    const { result } = await renderReady(createState({ enabled: false, keys: [] }));

    const pendingKey = createKey({ active: false, pendingActivation: true });
    const toggledState = createState({ keys: [pendingKey], progress: { pending: 12, total: 12 } });
    mockedSetEncryptionEnabled.mockResolvedValueOnce(toggledState);

    let outcome;
    await act(async () => {
      outcome = await result.current.setEnabled(true);
    });

    expect(outcome).toEqual({ ok: true, state: toggledState });
    expect(mockedSetEncryptionEnabled).toHaveBeenCalledWith(true);
    await waitFor(() => {
      expect(result.current.state).toEqual(toggledState);
    });
    // The PATCH answers with the same shape GET would, so nothing needs re-reading right away;
    // the in-flight poll below takes it from here.
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });

  it('polls while a change is in flight, and stops once the state has settled', async () => {
    vi.useFakeTimers();

    try {
      const inFlight = createState({
        keys: [createKey({ active: false, pendingActivation: true })],
        progress: { pending: 12, total: 12 },
      });
      const settled = createState();
      mockedFetchEncryptionState.mockResolvedValueOnce(inFlight).mockResolvedValueOnce(settled);

      const { result } = renderHook(() => useEncryption(), { wrapper: createWrapper() });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(result.current.state).toEqual(inFlight);
      expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHANGE_IN_FLIGHT_POLL_INTERVAL_MS);
      });
      expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
      // The query client hands results to React on its own timer; `vi.waitFor` advances fake
      // timers between checks, which a plain `waitFor` does not.
      await vi.waitFor(() => {
        expect(result.current.state).toEqual(settled);
      });

      // Settled: on, every row on the active key, nothing pending — no further reads.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHANGE_IN_FLIGHT_POLL_INTERVAL_MS * 3);
      });
      expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports a refused toggle without touching the cached state or refetching', async () => {
    const initial = createState({ enabled: false, keys: [], keyConfigured: false });
    const { result } = await renderReady(initial);

    const writeError = new ApiError(
      'The engine has no ENCRYPTION_KEY configured. Set it and restart the engine before turning encryption on.',
      { status: 503, code: 'ENCRYPTION_KEY_NOT_CONFIGURED' },
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

  it('shows the state a schedule change answers with at once, without a separate refetch', async () => {
    const { result } = await renderReady();

    const scheduled = createState({
      rotation: { interval: '48h', nextRotationAt: '2026-09-19T09:00:36.572Z' },
    });
    mockedSetEncryptionRotationInterval.mockResolvedValueOnce(scheduled);

    let outcome;
    await act(async () => {
      outcome = await result.current.setRotationInterval('48h');
    });

    expect(outcome).toEqual({ ok: true, state: scheduled });
    expect(mockedSetEncryptionRotationInterval).toHaveBeenCalledWith('48h');
    await waitFor(() => {
      expect(result.current.state).toEqual(scheduled);
    });
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
  });

  it('carries a null interval through, and reports a refused schedule change', async () => {
    const initial = createState();
    const { result } = await renderReady(initial);

    const writeError = new ApiError('Encryption is turned off, so there is no key to rotate.', {
      status: 409,
      code: 'ENCRYPTION_DISABLED',
    });
    mockedSetEncryptionRotationInterval.mockRejectedValueOnce(writeError);

    let outcome;
    await act(async () => {
      outcome = await result.current.setRotationInterval(null);
    });

    expect(mockedSetEncryptionRotationInterval).toHaveBeenCalledWith(null);
    expect(outcome).toEqual({ ok: false, error: writeError });
    expect(result.current.state).toEqual(initial);
    expect(mockedFetchEncryptionState).toHaveBeenCalledTimes(1);
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

    const writeError = new ApiError('Encryption is turned off, so there is no key to rotate.', {
      status: 409,
      code: 'ENCRYPTION_DISABLED',
    });
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
    expect(outcome && !outcome.ok ? outcome.error : null).toBeInstanceOf(ApiError);
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

    const { promise: schedulePromise, resolve: resolveSchedule } = deferred<EncryptionState>();
    mockedSetEncryptionRotationInterval.mockReturnValueOnce(schedulePromise);

    act(() => {
      outcomePromise = result.current.setRotationInterval('2w');
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBe('rotation');
    });

    resolveSchedule(createState());
    await act(async () => {
      await outcomePromise;
    });

    await waitFor(() => {
      expect(result.current.pendingAction).toBeNull();
    });
  });
});
