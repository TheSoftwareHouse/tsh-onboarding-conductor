import { queryOptions } from '@tanstack/react-query';
import { fetchActiveOrganization } from './organization';

/** Sibling module to `organization.ts` on purpose, so `vi.mock('@/api/organization/organization')` still intercepts `active`'s cross-module `queryFn` call. */
export const organizationQueries = {
  all: () => ['organization'] as const,
  active: () =>
    queryOptions({
      queryKey: [...organizationQueries.all(), 'active'],
      queryFn: () => fetchActiveOrganization(),
    }),
};
