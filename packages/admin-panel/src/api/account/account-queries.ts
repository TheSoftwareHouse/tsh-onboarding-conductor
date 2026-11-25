import { queryOptions } from '@tanstack/react-query';
import { fetchHasPassword } from './account';

/** Sibling module to `account.ts` on purpose, so `vi.mock('@/api/account/account')` still intercepts the cross-module `queryFn` call. */
export const accountQueries = {
  all: () => ['account'] as const,
  hasPassword: () =>
    queryOptions({
      queryKey: [...accountQueries.all(), 'has-password'],
      queryFn: () => fetchHasPassword(),
    }),
};
