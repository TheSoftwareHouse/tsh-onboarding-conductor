import { mutationOptions } from '@/services/query-client/mutation-options';
import {
  addEncryptionKey,
  requestReencryption,
  setEncryptionEnabled,
  setEncryptionRotationInterval,
  type EncryptionKeyRotationInterval,
} from './admin-encryption';

/** Sibling module to `admin-encryption.ts` on purpose, so `vi.mock('@/api/encryption/admin-encryption')` still intercepts the cross-module `mutationFn` calls. */
export const encryptionMutations = {
  setEnabled: () =>
    mutationOptions({
      mutationFn: (enabled: boolean) => setEncryptionEnabled(enabled),
    }),
  setRotationInterval: () =>
    mutationOptions({
      mutationFn: (interval: EncryptionKeyRotationInterval | null) =>
        setEncryptionRotationInterval(interval),
    }),
  addKey: () =>
    mutationOptions({
      mutationFn: () => addEncryptionKey(),
    }),
  reencrypt: () =>
    mutationOptions({
      mutationFn: () => requestReencryption(),
    }),
};
