import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEncryptionKey,
  EncryptionWriteError,
  fetchEncryptionState,
  setEncryptionEnabled,
  type EncryptionFetchError,
} from '../api/admin-encryption';
import type { EncryptionState } from '../types/encryption';

export type EncryptionPhase = 'loading' | 'error' | 'ready';

/** Which write is in flight, or `null` while none is. The two are never in flight together. */
export type EncryptionPendingAction = 'toggle' | 'add-key' | null;

/** Outcomes the page reacts to directly, without a second subscription to mutation state. */
export type ToggleOutcome =
  { ok: true; state: EncryptionState } | { ok: false; error: EncryptionWriteError };
export type AddKeyOutcome = { ok: true; id: string } | { ok: false; error: EncryptionWriteError };

const ENCRYPTION_QUERY_KEY = ['admin-encryption'] as const;

export interface UseEncryptionResult {
  phase: EncryptionPhase;
  state: EncryptionState | null;
  error: EncryptionFetchError | null;
  refetch: () => void;
  pendingAction: EncryptionPendingAction;
  setEnabled: (enabled: boolean) => Promise<ToggleOutcome>;
  addKey: () => Promise<AddKeyOutcome>;
}

function toWriteError(cause: unknown): EncryptionWriteError {
  return cause instanceof EncryptionWriteError
    ? cause
    : new EncryptionWriteError('Request failed.');
}

/**
 * Owns the encryption-state query and its two writes: the on/off toggle and key rotation.
 *
 * Mirrors useConnectors' explicit-action philosophy: nothing here refetches on its own. Each
 * write resolves to its own outcome so the page can react — report the new state, or why the
 * engine refused — and the state is refetched exactly once, only after the write succeeds. The
 * toggle also seeds the cache with the state the PATCH answered with, so the page flips before
 * that refetch lands; the refetch then picks up whatever the sweep has done since.
 */
export function useEncryption(): UseEncryptionResult {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery<
    EncryptionState,
    EncryptionFetchError
  >({
    queryKey: ENCRYPTION_QUERY_KEY,
    queryFn: fetchEncryptionState,
  });

  const { mutateAsync: toggle, isPending: toggling } = useMutation<
    EncryptionState,
    EncryptionWriteError,
    boolean
  >({
    mutationFn: setEncryptionEnabled,
  });

  const { mutateAsync: rotate, isPending: rotating } = useMutation<
    string,
    EncryptionWriteError,
    void
  >({
    mutationFn: addEncryptionKey,
  });

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<ToggleOutcome> => {
      try {
        const state = await toggle(enabled);
        queryClient.setQueryData(ENCRYPTION_QUERY_KEY, state);
        refetch();
        return { ok: true, state };
      } catch (cause) {
        return { ok: false, error: toWriteError(cause) };
      }
    },
    [queryClient, refetch, toggle],
  );

  const addKey = useCallback(async (): Promise<AddKeyOutcome> => {
    try {
      const id = await rotate();
      refetch();
      return { ok: true, id };
    } catch (cause) {
      return { ok: false, error: toWriteError(cause) };
    }
  }, [refetch, rotate]);

  return {
    // `isLoading` (no data yet AND a fetch in flight), not `isFetching`: once the first load has
    // landed, `phase` stays `ready` and `state` keeps the last-fetched value while a refetch is
    // in flight, so a write's own post-success refetch never blanks the page.
    phase: isLoading ? 'loading' : isError ? 'error' : 'ready',
    state: data ?? null,
    error,
    refetch,
    pendingAction: toggling ? 'toggle' : rotating ? 'add-key' : null,
    setEnabled,
    addKey,
  };
}
