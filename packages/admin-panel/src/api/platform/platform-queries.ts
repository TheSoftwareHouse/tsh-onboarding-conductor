import { queryOptions } from '@tanstack/react-query';
import {
  fetchPlatformOrganizations,
  fetchPlatformUsers,
  fetchSuperadmins,
  type PlatformUserFilters,
} from './platform';

/** Sibling module to `platform.ts` on purpose, so `vi.mock('@/api/platform/platform')` still intercepts the cross-module `queryFn` calls. */
export const platformQueries = {
  all: () => ['platform'] as const,
  /** Every user read — the lists and the superadmin count — so one invalidation covers them. */
  users: () => [...platformQueries.all(), 'users'] as const,
  userList: (filters: PlatformUserFilters) =>
    queryOptions({
      queryKey: [...platformQueries.users(), 'list', filters],
      queryFn: () => fetchPlatformUsers(filters),
    }),
  superadmins: () =>
    queryOptions({
      queryKey: [...platformQueries.users(), 'superadmins'],
      queryFn: () => fetchSuperadmins(),
    }),
  organizations: () =>
    queryOptions({
      queryKey: [...platformQueries.all(), 'organizations'],
      queryFn: () => fetchPlatformOrganizations(),
    }),
};
