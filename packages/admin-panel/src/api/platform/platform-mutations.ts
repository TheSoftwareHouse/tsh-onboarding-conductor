import { mutationOptions } from '@/services/query-client/mutation-options';
import {
  banUser,
  createOrganization,
  revokeUserSessions,
  setUserPassword,
  setUserRole,
  unbanUser,
  type PlatformRole,
} from './platform';
import { platformQueries } from './platform-queries';

const refreshUsers = () => [platformQueries.users()] as const;

/** Sibling module to `platform.ts` on purpose, so `vi.mock('@/api/platform/platform')` still intercepts the cross-module `mutationFn` calls. */
export const platformMutations = {
  setRole: () =>
    mutationOptions({
      mutationFn: (variables: { userId: string; role: PlatformRole }) =>
        setUserRole(variables.userId, variables.role),
      meta: { awaits: refreshUsers },
    }),
  ban: () =>
    mutationOptions({
      mutationFn: (userId: string) => banUser(userId),
      meta: { awaits: refreshUsers },
    }),
  unban: () =>
    mutationOptions({
      mutationFn: (userId: string) => unbanUser(userId),
      meta: { awaits: refreshUsers },
    }),
  revokeSessions: () =>
    mutationOptions({
      mutationFn: (userId: string) => revokeUserSessions(userId),
    }),
  setPassword: () =>
    mutationOptions({
      mutationFn: (variables: { userId: string; password: string }) =>
        setUserPassword(variables.userId, variables.password),
    }),
  createOrganization: () =>
    mutationOptions({
      mutationFn: (name: string) => createOrganization(name),
      // better-auth makes the new organization the session's active one, and every admin read is
      // scoped to it, so the whole cache is stale: the empty key matches every query.
      meta: { awaits: () => [[]] as const },
    }),
};
