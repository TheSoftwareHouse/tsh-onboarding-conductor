import { useCallback, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  addEncryptionKey,
  AddEncryptionKeyError,
  fetchEncryptionKeys,
  type EncryptionKeysFetchError,
  type EncryptionKeysList,
} from '../api/admin-encryption-keys';
import type { EncryptionKey, ReEncryptionProgress } from '../types/encryption-key';

export type EncryptionKeysPhase = 'loading' | 'error' | 'ready';

/** Outcome the page reacts to directly, without a second subscription to mutation state. */
export type AddEncryptionKeyOutcome =
  { ok: true; id: string } | { ok: false; error: AddEncryptionKeyError };

const ENCRYPTION_KEYS_QUERY_KEY = ['admin-encryption-keys'] as const;

const NO_PROGRESS: ReEncryptionProgress = { pending: 0, total: 0 };

export interface UseEncryptionKeysResult {
  phase: EncryptionKeysPhase;
  keys: EncryptionKey[];
  reEncryption: ReEncryptionProgress;
  error: EncryptionKeysFetchError | null;
  refetch: () => void;
  /** True while the add-key request is in flight. */
  adding: boolean;
  addKey: () => Promise<AddEncryptionKeyOutcome>;
}

/**
 * Owns the key-history query and the single add-key write.
 *
 * Mirrors useConnectors' explicit-action philosophy: nothing here refetches on its own. Adding a
 * key resolves to its own outcome so the page can react — show the new key, or report why it was
 * refused — and the list is refetched exactly once, only after the add succeeds.
 */
export function useEncryptionKeys(): UseEncryptionKeysResult {
  const { data, isLoading, isError, error, refetch } = useQuery<
    EncryptionKeysList,
    EncryptionKeysFetchError
  >({
    queryKey: ENCRYPTION_KEYS_QUERY_KEY,
    queryFn: fetchEncryptionKeys,
  });

  const [adding, setAdding] = useState(false);

  const addMutation = useMutation<string, AddEncryptionKeyError, void>({
    mutationFn: addEncryptionKey,
  });

  const addKey = useCallback(async (): Promise<AddEncryptionKeyOutcome> => {
    setAdding(true);
    try {
      const id = await addMutation.mutateAsync();
      refetch();
      return { ok: true, id };
    } catch (cause) {
      const error =
        cause instanceof AddEncryptionKeyError
          ? cause
          : new AddEncryptionKeyError('Request failed.');
      return { ok: false, error };
    } finally {
      setAdding(false);
    }
  }, [addMutation, refetch]);

  return {
    phase: isLoading ? 'loading' : isError ? 'error' : 'ready',
    keys: data?.keys ?? [],
    reEncryption: data?.reEncryption ?? NO_PROGRESS,
    error,
    refetch,
    adding,
    addKey,
  };
}
