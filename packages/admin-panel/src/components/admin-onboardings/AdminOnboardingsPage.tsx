import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { AdminOnboardingsFetchError } from '../../api/admin-onboardings';
import {
  filterAdminOnboardings,
  type AdminOnboardingFilters,
} from '../../filter-admin-onboardings';
import { useAdminOnboardings } from '../../hooks/useAdminOnboardings';
import type { AdminOnboardingSummary } from '../../types/admin-onboarding';
import { OnboardingFilters, WORKFLOW_VERSION_ERROR_MESSAGE } from './OnboardingFilters';
import { OnboardingResults } from './OnboardingResults';

function createDefaultFilters(): AdminOnboardingFilters {
  return {
    status: '',
    workflowId: '',
    workflowVersion: '',
    currentStep: '',
    onboardingId: '',
  };
}

function describeFetchError(error: AdminOnboardingsFetchError): string {
  return `Unable to load onboardings: ${error.message}`;
}

/** Composes the admin onboardings page: filters, live status region, and results table. */
export function AdminOnboardingsPage(): ReactElement {
  const { phase, records, error, reload } = useAdminOnboardings();
  const [filters, setFilters] = useState<AdminOnboardingFilters>(createDefaultFilters);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    reload();
  };

  const handleReset = (): void => {
    setFilters(createDefaultFilters());
  };

  const updateFilter = <K extends keyof AdminOnboardingFilters>(
    key: K,
    value: AdminOnboardingFilters[K],
  ): void => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const disabled = phase === 'loading';
  const filterResult = filterAdminOnboardings(records, filters);
  const showTable = phase === 'ready';
  const workflowVersionInvalid = showTable && filterResult.workflowVersionInvalid;

  let statusMessage: string;
  let visibleRecords: AdminOnboardingSummary[] = [];
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading onboardings\u2026';
  } else if (phase === 'error') {
    statusMessage = error ? describeFetchError(error) : 'Unable to load onboardings.';
  } else if (filterResult.workflowVersionInvalid) {
    statusMessage = WORKFLOW_VERSION_ERROR_MESSAGE;
    emptyMessage = 'Enter a valid workflow version to see results.';
  } else if (records.length === 0) {
    statusMessage = 'No onboardings were returned.';
    emptyMessage = 'No onboardings were returned.';
  } else if (filterResult.records.length === 0) {
    statusMessage = 'No onboardings match the current filters.';
    emptyMessage = 'No onboardings match the current filters.';
  } else {
    statusMessage = `Showing ${filterResult.records.length} of ${records.length} onboardings.`;
    visibleRecords = filterResult.records;
  }

  return (
    <div className="page">
      <h1>Admin onboardings</h1>
      <OnboardingFilters
        filters={filters}
        disabled={disabled}
        workflowVersionInvalid={workflowVersionInvalid}
        onFilterChange={updateFilter}
        onSubmit={handleSubmit}
        onReset={handleReset}
      />
      <OnboardingResults
        statusMessage={statusMessage}
        showTable={showTable}
        visibleRecords={visibleRecords}
        emptyMessage={emptyMessage}
      />
    </div>
  );
}
