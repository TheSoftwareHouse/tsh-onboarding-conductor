import type { FormEvent, ReactElement } from 'react';
import {
  DateTimeRangeField,
  type DateTimeRange,
} from '@/components/ui/filters/DateTimeRangeField/DateTimeRangeField';
import { FilterPanel } from '@/components/ui/filters/FilterPanel/FilterPanel';
import { PageSizeFilterField } from '@/components/ui/filters/PageSizeFilterField/PageSizeFilterField';
import {
  SelectFilterField,
  toFilterOptions,
} from '@/components/ui/filters/SelectFilterField/SelectFilterField';
import { TextFilterField } from '@/components/ui/filters/TextFilterField/TextFilterField';
import type { PageSize } from '@/lib/pagination';
import { AUDIT_ACTOR_TYPES } from '@/api/audit/audit-events';
import { describeAuditActorType } from '../../utils/describe-audit-events';
import {
  AUDIT_FILTER_MAX_LENGTHS,
  type AuditEventFilters as AuditFiltersValue,
} from '../../utils/filter-audit-events';

/** Element both window bounds are described by, since one message refuses the pair. */
const OCCURRED_ERROR_ID = 'occurred-error';

const ACTOR_TYPE_OPTIONS = toFilterOptions(AUDIT_ACTOR_TYPES, describeAuditActorType);

export interface AuditFiltersProps {
  filters: AuditFiltersValue;
  /**
   * Count of the committed criteria - never the draft. The panel's active-criteria chip and its
   * shareable-link note count this, so neither appears until Apply has actually narrowed the list.
   */
  appliedCount: number;
  disabled: boolean;
  /** Message describing why the requested time window was refused, or null when it is valid. */
  occurredError: string | null;
  onFilterChange: <K extends keyof AuditFiltersValue>(key: K, value: AuditFiltersValue[K]) => void;
  /** Commits the whole window at once, since a period and the bounds replace one another. */
  onOccurredRangeChange: (range: DateTimeRange) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Every criterion the audit endpoint accepts, rendered in the shared filter panel. */
export function AuditFilters({
  filters,
  appliedCount,
  disabled,
  occurredError,
  onFilterChange,
  onOccurredRangeChange,
  onSubmit,
  onReset,
  onReload,
}: AuditFiltersProps): ReactElement {
  const occurredInvalid = occurredError !== null;

  return (
    <FilterPanel
      label="Filter audit events"
      appliedCount={appliedCount}
      disabled={disabled}
      error={{ id: OCCURRED_ERROR_ID, message: occurredError }}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
      <TextFilterField
        id="resource-id-filter"
        name="resourceId"
        label="Resource ID"
        maxLength={AUDIT_FILTER_MAX_LENGTHS.resourceId}
        disabled={disabled}
        value={filters.resourceId}
        onChange={(value: string) => onFilterChange('resourceId', value)}
      />
      <SelectFilterField
        id="actor-type-filter"
        name="actorType"
        label="Actor"
        anyOptionLabel="All actors"
        options={ACTOR_TYPE_OPTIONS}
        disabled={disabled}
        value={filters.actorType}
        onChange={(value: string) =>
          onFilterChange('actorType', value as AuditFiltersValue['actorType'])
        }
      />
      <TextFilterField
        id="actor-id-filter"
        name="actorId"
        label="Actor ID"
        maxLength={AUDIT_FILTER_MAX_LENGTHS.actorId}
        disabled={disabled}
        value={filters.actorId}
        onChange={(value: string) => onFilterChange('actorId', value)}
      />
      <TextFilterField
        id="action-filter"
        name="action"
        label="Action"
        maxLength={AUDIT_FILTER_MAX_LENGTHS.action}
        disabled={disabled}
        value={filters.action}
        onChange={(value: string) => onFilterChange('action', value)}
      />
      <DateTimeRangeField
        label="Occurred"
        idPrefix="occurred"
        fromName="occurredFrom"
        toName="occurredTo"
        describedBy={OCCURRED_ERROR_ID}
        invalid={occurredInvalid}
        disabled={disabled}
        value={{
          period: filters.occurredPeriod,
          from: filters.occurredFrom,
          to: filters.occurredTo,
        }}
        onChange={onOccurredRangeChange}
      />
      <PageSizeFilterField
        disabled={disabled}
        value={filters.limit}
        onChange={(limit: PageSize) => onFilterChange('limit', limit)}
      />
    </FilterPanel>
  );
}
