import type { ChangeEvent, FormEvent, ReactElement } from 'react';
import {
  type AdminOnboardingFilters as AdminOnboardingFiltersValue,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from '../utils/filter-admin-onboardings';

export interface OnboardingFiltersProps {
  filters: AdminOnboardingFiltersValue;
  disabled: boolean;
  workflowVersionInvalid: boolean;
  onFilterChange: <K extends keyof AdminOnboardingFiltersValue>(
    key: K,
    value: AdminOnboardingFiltersValue[K],
  ) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReset: () => void;
  onReload: () => void;
}

/** Renders the labelled filter form: status select, four text inputs, and Reload/Reset actions. */
export function OnboardingFilters({
  filters,
  disabled,
  workflowVersionInvalid,
  onFilterChange,
  onSubmit,
  onReset,
  onReload,
}: OnboardingFiltersProps): ReactElement {
  return (
    <form className="filters" aria-label="Filter onboardings" onSubmit={onSubmit} onReset={onReset}>
      <div className="field">
        <label htmlFor="status-filter">Status</label>
        <select
          id="status-filter"
          name="status"
          disabled={disabled}
          value={filters.status}
          onChange={(event: ChangeEvent<HTMLSelectElement>) =>
            onFilterChange('status', event.target.value as AdminOnboardingFiltersValue['status'])
          }
        >
          <option value="">All</option>
          <option value="awaiting_user">Awaiting user</option>
          <option value="approved">Approved</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="workflow-id-filter">Workflow ID</label>
        <input
          id="workflow-id-filter"
          name="workflowId"
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={filters.workflowId}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('workflowId', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="workflow-version-filter">Workflow version</label>
        <input
          id="workflow-version-filter"
          name="workflowVersion"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          aria-describedby="workflow-version-error"
          aria-invalid={workflowVersionInvalid}
          disabled={disabled}
          value={filters.workflowVersion}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('workflowVersion', event.target.value)
          }
        />
        <p id="workflow-version-error" className="field-error" hidden={!workflowVersionInvalid}>
          {WORKFLOW_VERSION_ERROR_MESSAGE}
        </p>
      </div>
      <div className="field">
        <label htmlFor="current-step-filter">Current step</label>
        <input
          id="current-step-filter"
          name="currentStep"
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={filters.currentStep}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('currentStep', event.target.value)
          }
        />
      </div>
      <div className="field">
        <label htmlFor="onboarding-id-filter">Onboarding ID</label>
        <input
          id="onboarding-id-filter"
          name="onboardingId"
          type="text"
          autoComplete="off"
          disabled={disabled}
          value={filters.onboardingId}
          onChange={(event: ChangeEvent<HTMLInputElement>) =>
            onFilterChange('onboardingId', event.target.value)
          }
        />
      </div>
      <div className="actions">
        <button type="submit" disabled={disabled}>
          Apply filters
        </button>
        <button type="button" disabled={disabled} onClick={onReload}>
          Reload
        </button>
        <button type="reset" disabled={disabled}>
          Reset filters
        </button>
      </div>
    </form>
  );
}
