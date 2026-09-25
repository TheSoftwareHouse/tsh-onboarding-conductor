import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addEncryptionKey,
  EncryptionWriteError,
  requestReencryption,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
  type EncryptionFetchError,
  type EncryptionKeyRotationInterval,
  type EncryptionState,
} from '@/api/encryption/admin-encryption';
import { encryptionQueries } from '@/api/encryption/encryption-queries';
import { isEncryptionChangeInFlight } from '../utils/encryption-status';

export type EncryptionPhase = 'loading' | 'error' | 'ready';

/** Which write is in flight, or `null` while none is. No two are ever in flight together. */
export type EncryptionPendingAction = 'toggle' | 'add-key' | 'rotation' | 'reencrypt' | null;

/** Outcomes the page reacts to directly, without a second subscription to mutation state. */
export type ToggleOutcome =
  { ok: true; state: EncryptionState } | { ok: false; error: EncryptionWriteError };
export type RotationOutcome =
  { ok: true; state: EncryptionState } | { ok: false; error: EncryptionWriteError };
export type AddKeyOutcome = { ok: true; id: string } | { ok: false; error: EncryptionWriteError };
export type ReencryptOutcome =
  { ok: true; state: EncryptionState } | { ok: false; error: EncryptionWriteError };

/**
 * How often the state is re-read while a change is still in flight. The engine's sweep moves one
 * batch per `ENCRYPTION_SWEEP_POLL_INTERVAL_MS` (5 s by default), so reading more often than that
 * would mostly show the same numbers twice.
 */
export const CHANGE_IN_FLIGHT_POLL_INTERVAL_MS = 5000;

export interface UseEncryptionResult {
  phase: EncryptionPhase;
  state: EncryptionState | null;
  error: EncryptionFetchError | null;
  refetch: () => void;
  pendingAction: EncryptionPendingAction;
  setEnabled: (enabled: boolean) => Promise<ToggleOutcome>;
  setRotationInterval: (interval: EncryptionKeyRotationInterval | null) => Promise<RotationOutcome>;
  addKey: () => Promise<AddKeyOutcome>;
  reencrypt: () => Promise<ReencryptOutcome>;
}

function toWriteError(cause: unknown): EncryptionWriteError {
  return cause instanceof EncryptionWriteError
    ? cause
    : new EncryptionWriteError('Request failed.');
}

/**
 * Owns the encryption-state query and its three writes: the on/off toggle, the automatic-rotation
 * schedule, and rotating the key now.
 *
 * Follows useConnectors' explicit-action philosophy with one bounded exception. In a settled
 * state nothing here refetches on its own. While a change is in flight — a key pending activation
 * or retirement, or rows the sweep has yet to move (`isEncryptionChangeInFlight`) — the query
 * polls every `CHANGE_IN_FLIGHT_POLL_INTERVAL_MS`, so the operator watches the sweep converge,
 * and it stops the moment the state settles. This page shows counts, not
 * rows under a cursor, so the concern that rules out background refresh elsewhere in the panel
 * does not apply. Each write resolves to its own outcome so the page can react — report the new
 * state, or why the engine refused. The toggle seeds the cache with the state the PATCH answered
 * with, the same shape GET returns, and the in-flight poll takes it from there; so does the
 * schedule, which answers the same way. Rotating now answers with only the new key's id, so it
 * refetches once instead.
 */
export function useEncryption(): UseEncryptionResult {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error, refetch } = useQuery<
    EncryptionState,
    EncryptionFetchError
  >({
    ...encryptionQueries.state(),
    refetchInterval: (query) =>
      query.state.data !== undefined && isEncryptionChangeInFlight(query.state.data)
        ? CHANGE_IN_FLIGHT_POLL_INTERVAL_MS
        : false,
  });

  const { mutateAsync: toggle, isPending: toggling } = useMutation<
    EncryptionState,
    EncryptionWriteError,
    boolean
  >({
    mutationFn: setEncryptionEnabled,
  });

  const { mutateAsync: schedule, isPending: scheduling } = useMutation<
    EncryptionState,
    EncryptionWriteError,
    EncryptionKeyRotationInterval | null
  >({
    mutationFn: setEncryptionRotationInterval,
  });

  const { mutateAsync: rotate, isPending: rotating } = useMutation<
    string,
    EncryptionWriteError,
    void
  >({
    mutationFn: addEncryptionKey,
  });

  const { mutateAsync: reencryptAll, isPending: reencrypting } = useMutation<
    EncryptionState,
    EncryptionWriteError,
    void
  >({
    mutationFn: requestReencryption,
  });

  const setEnabled = useCallback(
    async (enabled: boolean): Promise<ToggleOutcome> => {
      try {
        const state = await toggle(enabled);
        queryClient.setQueryData(encryptionQueries.state().queryKey, state);
        return { ok: true, state };
      } catch (cause) {
        return { ok: false, error: toWriteError(cause) };
      }
    },
    [queryClient, toggle],
  );

  const setRotationInterval = useCallback(
    async (interval: EncryptionKeyRotationInterval | null): Promise<RotationOutcome> => {
      try {
        const state = await schedule(interval);
        queryClient.setQueryData(encryptionQueries.state().queryKey, state);
        return { ok: true, state };
      } catch (cause) {
        return { ok: false, error: toWriteError(cause) };
      }
    },
    [queryClient, schedule],
  );

  const reencrypt = useCallback(async (): Promise<ReencryptOutcome> => {
    try {
      const state = await reencryptAll();
      queryClient.setQueryData(encryptionQueries.state().queryKey, state);
      return { ok: true, state };
    } catch (cause) {
      return { ok: false, error: toWriteError(cause) };
    }
  }, [queryClient, reencryptAll]);

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
    pendingAction: toggling
      ? 'toggle'
      : rotating
        ? 'add-key'
        : scheduling
          ? 'rotation'
          : reencrypting
            ? 'reencrypt'
            : null,
    setEnabled,
    setRotationInterval,
    addKey,
    reencrypt,
  };
}
