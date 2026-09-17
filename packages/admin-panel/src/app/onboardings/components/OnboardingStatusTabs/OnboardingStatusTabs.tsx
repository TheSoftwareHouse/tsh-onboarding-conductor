import type { ReactElement } from 'react';
import { FilterTab, FilterTabs } from '@/components/ui/FilterTabs/FilterTabs';
import { ADMIN_ROUTES } from '@/constants/routes';
import { DEFAULT_PAGE } from '@/lib/pagination';
import {
  ADMIN_ONBOARDING_STATUSES,
  describeAdminOnboardingStatus,
} from '../../types/admin-onboarding';
import { serializeAdminOnboardingsSearch } from '../../utils/admin-onboardings-search-params';
import type { AdminOnboardingFilters } from '../../utils/filter-admin-onboardings';

export interface OnboardingStatusTabsProps {
  /** The committed filter set; every criterion but `status` survives onto each tab's link. */
  filters: AdminOnboardingFilters;
  /** `pagination.total`, shown only on the tab matching `filters.status`. */
  total: number;
}

function buildTabHref(
  filters: AdminOnboardingFilters,
  status: AdminOnboardingFilters['status'],
): string {
  const query = serializeAdminOnboardingsSearch({ ...filters, status }, DEFAULT_PAGE);
  return `${ADMIN_ROUTES.onboardings.root}${query}`;
}

/** The design's status tab strip: All plus one tab per real status, over the URL-backed filters. */
export function OnboardingStatusTabs({ filters, total }: OnboardingStatusTabsProps): ReactElement {
  return (
    <FilterTabs label="Status">
      <FilterTab
        to={buildTabHref(filters, '')}
        active={filters.status === ''}
        count={filters.status === '' ? total : undefined}
      >
        All
      </FilterTab>
      {ADMIN_ONBOARDING_STATUSES.map((status) => {
        const active = filters.status === status;
        return (
          <FilterTab
            key={status}
            to={buildTabHref(filters, status)}
            active={active}
            count={active ? total : undefined}
          >
            {describeAdminOnboardingStatus(status)}
          </FilterTab>
        );
      })}
    </FilterTabs>
  );
}
