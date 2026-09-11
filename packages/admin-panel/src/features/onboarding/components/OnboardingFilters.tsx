import type { FormEvent, ReactElement } from 'react';
import { FilterPanel, PageSizeFilterField, TextFilterField } from '@/shared/components/filters';
import { countActiveFilters } from '@/shared/lib/count-active-filters';
import type { PageSize } from '@/shared/lib/pagination';
import {
  type AdminOnboardingDraftFilters,
  type AdminOnboardingFilters as AdminOnboardingFiltersValue,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from '../utils/filter-admin-onboardings';

/** Element the workflow version input is described by while its value is refused. */
const WORKFLOW_VERSION_ERROR_ID = 'workflow-version-error';

export interface OnboardingFiltersProps {
  filters: AdminOnboardingDraftFilters;
  /**
   * The committed status. It commits from the tab strip rather than this panel, but it narrows
   * the list all the same, so the active-criteria badge has to count it.
   */
  status: AdminOnboardingFiltersValue['status'];
  disabled: boolean;
  workflowVersionInvalid: boolean;
  onFilterChange: <K extends keyof AdminOnboardingDraftFilters>(
    key: K,
    value: AdminOnboardingDraftFilters[K],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Workflow ID, workflow version, current step and page size, rendered in the shared filter panel. */
export function OnboardingFilters({
  filters,
  status,
  disabled,
  workflowVersionInvalid,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: OnboardingFiltersProps): ReactElement {
  return (
    <FilterPanel
      label="Filter onboardings"
      activeCount={countActiveFilters({ ...filters, status }, ['limit'])}
      disabled={disabled}
      error={{
        id: WORKFLOW_VERSION_ERROR_ID,
        message: workflowVersionInvalid ? WORKFLOW_VERSION_ERROR_MESSAGE : null,
      }}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
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
        describedBy={WORKFLOW_VERSION_ERROR_ID}
        invalid={workflowVersionInvalid}
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
      <PageSizeFilterField
        disabled={disabled}
        value={filters.limit}
        onChange={(limit: PageSize) => onFilterChange('limit', limit)}
      />
    </FilterPanel>
  );
}
