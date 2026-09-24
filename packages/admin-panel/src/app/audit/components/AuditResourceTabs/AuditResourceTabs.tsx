import type { ReactElement } from 'react';
import { FilterTab, FilterTabs } from '@/components/ui/FilterTabs/FilterTabs';
import { ADMIN_ROUTES } from '@/constants/routes';
import { DEFAULT_PAGE } from '@/lib/pagination';
import { AUDIT_RESOURCE_TYPES } from '@/api/audit/audit-events';
import { serializeAuditEventsSearch } from '../../utils/audit-events-search-params';
import { describeAuditResourceType } from '../../utils/describe-audit-events';
import type { AuditEventFilters } from '../../utils/filter-audit-events';

export interface AuditResourceTabsProps {
  /** The committed filter set; every criterion but `resourceType` survives onto each tab's link. */
  filters: AuditEventFilters;
  /** `pagination.total`, shown only on the tab matching `filters.resourceType`. */
  total: number;
}

function buildTabHref(filters: AuditEventFilters, resourceType: string): string {
  const query = serializeAuditEventsSearch({ ...filters, resourceType }, DEFAULT_PAGE);
  return `${ADMIN_ROUTES.audit.root}${query}`;
}

/** The design's resource-type tab strip: All plus one tab per `AUDIT_RESOURCE_TYPES` entry. */
export function AuditResourceTabs({ filters, total }: AuditResourceTabsProps): ReactElement {
  return (
    <FilterTabs label="Resource type">
      <FilterTab
        to={buildTabHref(filters, '')}
        active={filters.resourceType === ''}
        count={filters.resourceType === '' ? total : undefined}
      >
        All
      </FilterTab>
      {AUDIT_RESOURCE_TYPES.map((resourceType) => {
        const active = filters.resourceType === resourceType;
        return (
          <FilterTab
            key={resourceType}
            to={buildTabHref(filters, resourceType)}
            active={active}
            count={active ? total : undefined}
          >
            {describeAuditResourceType(resourceType)}
          </FilterTab>
        );
      })}
    </FilterTabs>
  );
}
