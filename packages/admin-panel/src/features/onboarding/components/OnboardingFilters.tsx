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
   * The committed set, read back from the URL - including the `status` the tab strip commits
   * outside this panel. The active-criteria chip and the shareable-link note count this rather
   * than the draft, so neither appears until Apply has actually narrowed the list.
   */
  appliedFilters: AdminOnboardingFiltersValue;
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

/** Onboarding ID, workflow ID, workflow version, current step and page size, rendered in the shared filter panel. */
export function OnboardingFilters({
  filters,
  appliedFilters,
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
      appliedCount={countActiveFilters(appliedFilters, ['limit'])}
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
