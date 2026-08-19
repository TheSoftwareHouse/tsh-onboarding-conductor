import type { FormEvent, ReactElement } from 'react';
import {
  DateTimePickerField,
  DateTimeQuickRanges,
  type DateTimeRange,
  FilterPanel,
  PageSizeFilterField,
  SelectFilterField,
  TextFilterField,
  toFilterOptions,
} from '@/shared/components/filters';
import { countActiveFilters } from '@/shared/lib/count-active-filters';
import type { PageSize } from '@/shared/lib/pagination';
import { AUDIT_ACTOR_TYPES, describeAuditActorType } from '../types/audit-event';
import {
  AUDIT_FILTER_MAX_LENGTHS,
  type AuditEventFilters as AuditFiltersValue,
} from '../utils/filter-audit-events';

/** Element both window bounds are described by, since one message refuses the pair. */
const OCCURRED_ERROR_ID = 'occurred-error';

const ACTOR_TYPE_OPTIONS = toFilterOptions(AUDIT_ACTOR_TYPES, describeAuditActorType);

export interface AuditFiltersProps {
  filters: AuditFiltersValue;
  disabled: boolean;
  /** Message describing why the requested time window was refused, or null when it is valid. */
  occurredError: string | null;
  onFilterChange: <K extends keyof AuditFiltersValue>(key: K, value: AuditFiltersValue[K]) => void;
  /** Commits both bounds at once, since a quick range moves them together. */
  onOccurredRangeChange: (range: DateTimeRange) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Every criterion the audit endpoint accepts, rendered in the shared filter panel. */
export function AuditFilters({
  filters,
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
      activeCount={countActiveFilters(filters, ['limit'])}
      disabled={disabled}
      error={{ id: OCCURRED_ERROR_ID, message: occurredError }}
      shortcuts={
        <DateTimeQuickRanges
          legend="Occurred"
          value={{ from: filters.occurredFrom, to: filters.occurredTo }}
          disabled={disabled}
          onChange={onOccurredRangeChange}
        />
      }
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
      <SelectFilterField
        id="actor-type-filter"
        name="actorType"
        label="Actor type"
        anyOptionLabel="All"
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
      <TextFilterField
        id="resource-type-filter"
        name="resourceType"
        label="Resource type"
        maxLength={AUDIT_FILTER_MAX_LENGTHS.resourceType}
        disabled={disabled}
        value={filters.resourceType}
        onChange={(value: string) => onFilterChange('resourceType', value)}
      />
      <TextFilterField
        id="resource-id-filter"
        name="resourceId"
        label="Resource ID"
        maxLength={AUDIT_FILTER_MAX_LENGTHS.resourceId}
        disabled={disabled}
        value={filters.resourceId}
        onChange={(value: string) => onFilterChange('resourceId', value)}
      />
      <DateTimePickerField
        id="occurred-from-filter"
        name="occurredFrom"
        label="Occurred from"
        describedBy={OCCURRED_ERROR_ID}
        invalid={occurredInvalid}
        disabled={disabled}
        value={filters.occurredFrom}
        onChange={(value: string) => onFilterChange('occurredFrom', value)}
      />
      <DateTimePickerField
        id="occurred-to-filter"
        name="occurredTo"
        label="Occurred to"
        describedBy={OCCURRED_ERROR_ID}
        invalid={occurredInvalid}
        disabled={disabled}
        value={filters.occurredTo}
        onChange={(value: string) => onFilterChange('occurredTo', value)}
      />
      <PageSizeFilterField
        disabled={disabled}
        value={filters.limit}
        onChange={(limit: PageSize) => onFilterChange('limit', limit)}
      />
    </FilterPanel>
  );
}
