import type { FormEvent, ReactElement } from 'react';
import {
  DateTimeRangeField,
  type DateTimeRange,
  FilterPanel,
  PageSizeFilterField,
  SelectFilterField,
  TextFilterField,
  toFilterOptions,
} from '@/shared/components/filters';
import type { PageSize } from '@/shared/lib/pagination';
import { AUDIT_ACTOR_TYPES, describeAuditActorType } from '../types/audit-event';
import {
  AUDIT_FILTER_MAX_LENGTHS,
  countActiveAuditFilters,
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
  /** Commits the whole window at once, since a period and the bounds replace one another. */
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
      activeCount={countActiveAuditFilters(filters)}
      disabled={disabled}
      error={{ id: OCCURRED_ERROR_ID, message: occurredError }}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
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
