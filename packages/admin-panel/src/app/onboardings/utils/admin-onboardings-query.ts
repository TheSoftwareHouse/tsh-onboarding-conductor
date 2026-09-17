import { DEFAULT_PAGE_SIZE } from '@/lib/pagination';
import type {
  AdminOnboardingFilters,
  AdminOnboardingQueryFilters,
} from './filter-admin-onboardings';
import type { AdminOnboardingsSearchValues } from './admin-onboardings-search-params';

export const ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX = 'admin-onboardings' as const;

/** Canonical React Query key: the endpoint's supported, validated query filters only. */
export type AdminOnboardingsQueryKey = readonly [
  typeof ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX,
  AdminOnboardingQueryFilters,
];

/** Draft filter control values reset to "no criteria applied". Frozen: every consumer shares it. */
export const DEFAULT_ADMIN_ONBOARDING_FILTERS: AdminOnboardingFilters = Object.freeze({
  status: '',
  workflowId: '',
  workflowVersion: '',
  currentStep: '',
  onboardingId: '',
  limit: DEFAULT_PAGE_SIZE,
});

/** The canonical query key for a committed search state: the prefix plus the query filters it names. */
export function buildAdminOnboardingsQueryKey(
  state: AdminOnboardingsSearchValues,
): AdminOnboardingsQueryKey {
  return [
    ADMIN_ONBOARDINGS_QUERY_KEY_PREFIX,
    {
      page: state.page,
      limit: state.limit,
      status: state.status,
      workflowId: state.workflowId,
      workflowVersion: state.workflowVersion,
      currentStep: state.currentStep,
      onboardingId: state.onboardingId,
    },
  ];
}
