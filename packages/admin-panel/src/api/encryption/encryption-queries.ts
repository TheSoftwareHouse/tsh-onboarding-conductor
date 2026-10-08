import { queryOptions } from '@tanstack/react-query';
import { fetchEncryptionState } from './admin-encryption';

/** Sibling module to `admin-encryption.ts` on purpose, so `vi.mock('@/api/encryption/admin-encryption')` still intercepts `state`'s cross-module `queryFn` call. */
export const encryptionQueries = {
  all: () => ['encryption'] as const,
  state: () =>
    queryOptions({
      queryKey: [...encryptionQueries.all(), 'state'],
      queryFn: () => fetchEncryptionState(),
    }),
};
