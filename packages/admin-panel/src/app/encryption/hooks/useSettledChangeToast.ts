import { useCallback, useEffect, useRef } from 'react';
import type { EncryptionState } from '@/api/encryption/admin-encryption';
import { showSuccessToast } from '@/components/ui/Toast/toast-manager';
import {
  REENCRYPT_SETTLED_TITLE,
  TOGGLE_SETTLED_TITLE,
  type EncryptionPendingChange,
} from '../constants/encryption-toasts';
import { isEncryptionChangeInFlight } from '../utils/encryption-status';

export interface UseSettledChangeToastResult {
  /** Marks a background write this page just started, so its settled toast fires once it finishes. */
  notifyPending: (change: EncryptionPendingChange, result: EncryptionState) => void;
}

function settledTitle(change: EncryptionPendingChange): string {
  return change === 'reencrypt' ? REENCRYPT_SETTLED_TITLE : TOGGLE_SETTLED_TITLE[change];
}

/**
 * Raises the Copy (Encryption) settled-success toast once a toggle or re-encrypt this page started
 * finishes in the background — the moment `isEncryptionChangeInFlight(state)` first turns `false`
 * after that write. Nothing fires for a change settling with no pending write from here.
 */
export function useSettledChangeToast(state: EncryptionState | null): UseSettledChangeToastResult {
  const pendingRef = useRef<EncryptionPendingChange | null>(null);

  useEffect(() => {
    if (pendingRef.current && state && !isEncryptionChangeInFlight(state)) {
      showSuccessToast(settledTitle(pendingRef.current));
      pendingRef.current = null;
    }
  }, [state]);

  const notifyPending = useCallback((change: EncryptionPendingChange, result: EncryptionState) => {
    // The write's own response may already show the change settled — nothing left to watch for.
    // A new write supersedes whatever this page was still waiting on.
    pendingRef.current = null;

    if (!isEncryptionChangeInFlight(result)) {
      showSuccessToast(settledTitle(change));
      return;
    }

    pendingRef.current = change;
  }, []);

  return { notifyPending };
}
