import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEncryptionKeys } from './useEncryptionKeys';
import {
  addEncryptionKey,
  AddEncryptionKeyError,
  EncryptionKeysFetchError,
  fetchEncryptionKeys,
} from '../api/admin-encryption-keys';
import type { EncryptionKey } from '../types/encryption-key';

vi.mock('../api/admin-encryption-keys', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/admin-encryption-keys')>();

  return {
    ...actual,
    fetchEncryptionKeys: vi.fn(),
    addEncryptionKey: vi.fn(),
  };
});

const mockedFetchEncryptionKeys = vi.mocked(fetchEncryptionKeys);
const mockedAddEncryptionKey = vi.mocked(addEncryptionKey);

function encryptionKey(overrides: Partial<EncryptionKey> = {}): EncryptionKey {
  return {
    id: '01a0ae98-ad4d-72ac-9f17-74e08efa00fd',
    createdAt: '2026-09-17T09:00:36.572Z',
    createdBy: 'unknown',
    activatedAt: '2026-09-17T09:00:36.557Z',
    deletedAt: null,
    active: true,
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
  mockedFetchEncryptionKeys.mockReset();
  mockedAddEncryptionKey.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useEncryptionKeys', () => {
  it('reports loading then ready with the fetched keys and progress', async () => {
    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [encryptionKey()],
      reEncryption: { pending: 2, total: 5 },
    });

    const { result } = renderHook(() => useEncryptionKeys(), { wrapper: createWrapper() });

    expect(result.current.phase).toBe('loading');
    expect(result.current.keys).toEqual([]);
    expect(result.current.reEncryption).toEqual({ pending: 0, total: 0 });

    await waitFor(() => {
      expect(result.current.phase).toBe('ready');
    });
    expect(result.current.keys).toEqual([encryptionKey()]);
    expect(result.current.reEncryption).toEqual({ pending: 2, total: 5 });
    expect(result.current.error).toBeNull();
  });

  it('reports the fetch error', async () => {
    const fetchError = new EncryptionKeysFetchError('request-failed', 'Failed to fetch', 500);
    mockedFetchEncryptionKeys.mockRejectedValueOnce(fetchError);

    const { result } = renderHook(() => useEncryptionKeys(), { wrapper: createWrapper() });

    await waitFor(() => {
      expect(result.current.phase).toBe('error');
    });
    expect(result.current.keys).toEqual([]);
    expect(result.current.error).toBe(fetchError);
  });

  it('refetches the list after a successful add, exactly once', async () => {
    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [encryptionKey({ active: false, deletedAt: '2026-09-17T09:00:36.575Z' })],
      reEncryption: { pending: 0, total: 0 },
    });

    const { result } = renderHook(() => useEncryptionKeys(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    mockedAddEncryptionKey.mockResolvedValueOnce('new-key-id');
    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [encryptionKey({ id: 'new-key-id' })],
      reEncryption: { pending: 1, total: 1 },
    });

    let outcome;
    await act(async () => {
      outcome = await result.current.addKey();
    });

    expect(outcome).toEqual({ ok: true, id: 'new-key-id' });
    expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(2);
    await waitFor(() => {
      expect(result.current.keys).toEqual([encryptionKey({ id: 'new-key-id' })]);
    });
    expect(result.current.reEncryption).toEqual({ pending: 1, total: 1 });
  });

  it('reports a failed add without refetching, and clears adding afterwards', async () => {
    mockedFetchEncryptionKeys.mockResolvedValueOnce({
      keys: [encryptionKey()],
      reEncryption: { pending: 0, total: 0 },
    });

    const { result } = renderHook(() => useEncryptionKeys(), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.phase).toBe('ready'));

    const addError = new AddEncryptionKeyError(
      'Encryption is not enabled, so there is no key to rotate.',
      409,
      true,
    );
    mockedAddEncryptionKey.mockRejectedValueOnce(addError);

    let outcome;
    await act(async () => {
      outcome = await result.current.addKey();
    });

    expect(outcome).toEqual({ ok: false, error: addError });
    expect(mockedFetchEncryptionKeys).toHaveBeenCalledTimes(1);
    expect(result.current.adding).toBe(false);
  });
});
