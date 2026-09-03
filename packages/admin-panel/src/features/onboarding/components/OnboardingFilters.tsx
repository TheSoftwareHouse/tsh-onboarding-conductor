import type { FormEvent, ReactElement } from 'react';
import {
  FilterPanel,
  PageSizeFilterField,
  SelectFilterField,
  TextFilterField,
  toFilterOptions,
} from '@/shared/components/filters';
import { countActiveFilters } from '@/shared/lib/count-active-filters';
import type { PageSize } from '@/shared/lib/pagination';
import {
  ADMIN_ONBOARDING_STATUSES,
  describeAdminOnboardingStatus,
} from '../types/admin-onboarding';
import {
  type AdminOnboardingFilters as AdminOnboardingFiltersValue,
  SCORE_ERROR_MESSAGE,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from '../utils/filter-admin-onboardings';

/**
 * The panel states one message at a time, so every input that can be refused is described by the
 * same region and the message names which criterion was rejected.
 */
const FILTER_ERROR_ID = 'onboarding-filter-error';

const STATUS_OPTIONS = toFilterOptions(ADMIN_ONBOARDING_STATUSES, describeAdminOnboardingStatus);

export interface OnboardingFiltersProps {
  filters: AdminOnboardingFiltersValue;
  disabled: boolean;
  workflowVersionInvalid: boolean;
  scoreInvalid: boolean;
  onFilterChange: <K extends keyof AdminOnboardingFiltersValue>(
    key: K,
    value: AdminOnboardingFiltersValue[K],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Every criterion the admin onboardings endpoint accepts, rendered in the shared filter panel. */
export function OnboardingFilters({
  filters,
  disabled,
  workflowVersionInvalid,
  scoreInvalid,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: OnboardingFiltersProps): ReactElement {
  return (
    <FilterPanel
      label="Filter onboardings"
      activeCount={countActiveFilters(filters, ['limit', 'sortBy', 'sortDir'])}
      disabled={disabled}
      error={{
        id: FILTER_ERROR_ID,
        message: workflowVersionInvalid
          ? WORKFLOW_VERSION_ERROR_MESSAGE
          : scoreInvalid
            ? SCORE_ERROR_MESSAGE
            : null,
      }}
      onSubmit={onSubmit}
      onReset={onReset}
      onReload={onReload}
    >
      <SelectFilterField
        id="status-filter"
        name="status"
        label="Status"
        anyOptionLabel="All"
        options={STATUS_OPTIONS}
        disabled={disabled}
        value={filters.status}
        onChange={(value: string) =>
          onFilterChange('status', value as AdminOnboardingFiltersValue['status'])
        }
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
      <TextFilterField
        id="onboarding-id-filter"
        name="onboardingId"
        label="Onboarding ID"
        disabled={disabled}
        value={filters.onboardingId}
        onChange={(value: string) => onFilterChange('onboardingId', value)}
      />
      <TextFilterField
        id="min-score-filter"
        name="minScore"
        label="Min score"
        inputMode="numeric"
        describedBy={FILTER_ERROR_ID}
        invalid={scoreInvalid}
        disabled={disabled}
        value={filters.minScore}
        onChange={(value: string) => onFilterChange('minScore', value)}
      />
      <TextFilterField
        id="max-score-filter"
        name="maxScore"
        label="Max score"
        inputMode="numeric"
        describedBy={FILTER_ERROR_ID}
        invalid={scoreInvalid}
        disabled={disabled}
        value={filters.maxScore}
        onChange={(value: string) => onFilterChange('maxScore', value)}
      />
      <PageSizeFilterField
        disabled={disabled}
        value={filters.limit}
        onChange={(limit: PageSize) => onFilterChange('limit', limit)}
      />
    </FilterPanel>
  );
}
