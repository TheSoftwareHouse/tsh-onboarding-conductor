import type { FormEvent, ReactElement } from 'react';
import { CheckboxFilterField } from '@/components/ui/filters/CheckboxFilterField/CheckboxFilterField';
import { DateTimePickerField } from '@/components/ui/filters/DateTimePickerField/DateTimePickerField';
import { FilterPanel } from '@/components/ui/filters/FilterPanel/FilterPanel';
import { PageSizeFilterField } from '@/components/ui/filters/PageSizeFilterField/PageSizeFilterField';
import { TextFilterField } from '@/components/ui/filters/TextFilterField/TextFilterField';
import { resolveLocalTimeZoneName } from '@/lib/datetime-local';
import type { PageSize } from '@/lib/pagination';
import {
  type AdminOnboardingDraftError,
  type AdminOnboardingDraftFilters,
  PENDING_CONNECTOR_ID_MAX_LENGTH,
} from '../utils/filter-admin-onboardings';

/** Element every refusable control is described by while its value is refused, since the panel has one message area. */
const FILTER_ERROR_ID = 'onboarding-filters-error';

export interface OnboardingFiltersProps {
  filters: AdminOnboardingDraftFilters;
  /**
   * Count of the committed criteria - never the draft - including the `status` the tab strip
   * commits outside this panel. The active-criteria chip and the shareable-link note count this,
   * so neither appears until Apply has actually narrowed the list.
   */
  appliedCount: number;
  disabled: boolean;
  /** The refused criterion and why, or null while every drafted value can be requested. */
  error: AdminOnboardingDraftError | null;
  onFilterChange: <K extends keyof AdminOnboardingDraftFilters>(
    key: K,
    value: AdminOnboardingDraftFilters[K],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Onboarding ID, workflow ID, workflow version, current step, the parked criteria and page size, rendered in the shared filter panel. */
export function OnboardingFilters({
  filters,
  appliedCount,
  disabled,
  error,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: OnboardingFiltersProps): ReactElement {
  const timeZone = resolveLocalTimeZoneName();
  const invalidField = error?.field ?? null;

  return (
    <FilterPanel
      label="Filter onboardings"
      appliedCount={appliedCount}
      disabled={disabled}
      error={{ id: FILTER_ERROR_ID, message: error?.message ?? null }}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
      <TextFilterField
        id="onboarding-id-filter"
        name="onboardingId"
        label="Onboarding ID"
        disabled={disabled}
        value={filters.onboardingId}
        onChange={(value: string) => onFilterChange('onboardingId', value)}
      />
      <TextFilterField
        id="workflow-id-filter"
        name="workflowId"
        label="Workflow ID"
        disabled={disabled}
        value={filters.workflowId}
        onChange={(value: string) => onFilterChange('workflowId', value)}
      />
      <TextFilterField
        id="workflow-version-filter"
        name="workflowVersion"
        label="Workflow version"
        inputMode="numeric"
        describedBy={FILTER_ERROR_ID}
        invalid={invalidField === 'workflowVersion'}
        disabled={disabled}
        value={filters.workflowVersion}
        onChange={(value: string) => onFilterChange('workflowVersion', value)}
      />
      <TextFilterField
        id="current-step-filter"
        name="currentStep"
        label="Current step"
        disabled={disabled}
        value={filters.currentStep}
        onChange={(value: string) => onFilterChange('currentStep', value)}
      />
      <CheckboxFilterField
        id="parked-filter"
        name="parked"
        label="Parked"
        disabled={disabled}
        value={filters.parked}
        onChange={(value: boolean) => onFilterChange('parked', value)}
      >
        Parked on a connector
      </CheckboxFilterField>
      <TextFilterField
        id="pending-connector-filter"
        name="pendingConnectorId"
        label="Pending connector"
        placeholder="Connector id"
        maxLength={PENDING_CONNECTOR_ID_MAX_LENGTH}
        describedBy={FILTER_ERROR_ID}
        invalid={invalidField === 'pendingConnectorId'}
        disabled={disabled}
        value={filters.pendingConnectorId}
        onChange={(value: string) => onFilterChange('pendingConnectorId', value)}
      />
      <div className="flex min-w-0 flex-col gap-2">
        <DateTimePickerField
          id="parked-before-filter"
          name="parkedBefore"
          label="Parked before"
          describedBy={FILTER_ERROR_ID}
          invalid={invalidField === 'parkedBefore'}
          disabled={disabled}
          value={filters.parkedBefore}
          onChange={(value: string) => onFilterChange('parkedBefore', value)}
        />
        {timeZone.length > 0 && <span className="text-caps-tiny text-fg-4">{timeZone}</span>}
      </div>
      <PageSizeFilterField
        disabled={disabled}
        value={filters.limit}
        onChange={(limit: PageSize) => onFilterChange('limit', limit)}
      />
    </FilterPanel>
  );
}
