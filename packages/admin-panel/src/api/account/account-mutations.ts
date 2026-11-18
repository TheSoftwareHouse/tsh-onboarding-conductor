import { mutationOptions } from '@/services/query-client/mutation-options';
import { disableTwoFactor } from './account';

/** Sibling module to `account.ts` on purpose, so `vi.mock('@/api/account/account')` still intercepts the cross-module `mutationFn` call. */
export const accountMutations = {
  // No invalidation: the two-factor state lives in the session, which better-auth refreshes itself
  // after every `/two-factor/*` call.
  disableTwoFactor: () =>
    mutationOptions({
      mutationFn: (password: string) => disableTwoFactor(password),
    }),
};
