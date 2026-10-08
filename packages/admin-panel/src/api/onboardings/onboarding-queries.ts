import { queryOptions } from '@tanstack/react-query';
import {
  fetchAdminOnboardingById,
  fetchAdminOnboardings,
  type AdminOnboardingQueryFilters,
} from './admin-onboardings';
import { fetchOnboardingTransitions } from './onboarding-transitions';

/** Sibling module to `admin-onboardings.ts` on purpose, so `vi.mock('@/api/onboardings/admin-onboardings')` still intercepts `list` and `detail`'s cross-module `queryFn` calls. */
export const onboardingQueries = {
  all: () => ['onboardings'] as const,
  lists: () => [...onboardingQueries.all(), 'list'] as const,
  list: (filters: AdminOnboardingQueryFilters) =>
    queryOptions({
      queryKey: [...onboardingQueries.lists(), filters],
      queryFn: () => fetchAdminOnboardings(filters),
    }),
  details: () => [...onboardingQueries.all(), 'details'] as const,
  detail: (id: string) =>
    queryOptions({
      queryKey: [...onboardingQueries.details(), id],
      queryFn: () => fetchAdminOnboardingById(id),
    }),
  transitions: (id: string) =>
    queryOptions({
      queryKey: [...onboardingQueries.details(), id, 'transitions'],
      queryFn: () => fetchOnboardingTransitions(id),
    }),
};
