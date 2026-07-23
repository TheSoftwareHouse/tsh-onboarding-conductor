import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { AdminOnboardingsFetchError } from '../../api/admin-onboardings';
import {
  type AdminOnboardingFilters,
  type AdminOnboardingQueryFilters,
  normalizeAdminOnboardingFilters,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from '../../filter-admin-onboardings';
import { useAdminOnboardings } from '../../hooks/useAdminOnboardings';
import type { AdminOnboardingSummary } from '../../types/admin-onboarding';
import { OnboardingFilters } from './OnboardingFilters';
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

function hasAppliedFilters(filters: AdminOnboardingFilters): boolean {
  return (
    filters.status !== '' ||
    filters.workflowId.trim().length > 0 ||
    filters.workflowVersion.trim().length > 0 ||
    filters.currentStep.trim().length > 0 ||
    filters.onboardingId.trim().length > 0
  );
}

function toAppliedFilters(queryFilters: AdminOnboardingQueryFilters): AdminOnboardingFilters {
  return {
    status: queryFilters.status ?? '',
    workflowId: queryFilters.workflowId ?? '',
    workflowVersion: queryFilters.workflowVersion ?? '',
    currentStep: queryFilters.currentStep ?? '',
    onboardingId: queryFilters.onboardingId ?? '',
  };
}

/** Composes the admin onboardings page: filters, live status region, and results table. */
export function AdminOnboardingsPage(): ReactElement {
  const { phase, records, error, appliedFilters, applyFilters, reload, resetFilters } =
    useAdminOnboardings();
  const [filters, setFilters] = useState<AdminOnboardingFilters>(createDefaultFilters);
  const [workflowVersionInvalid, setWorkflowVersionInvalid] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const normalized = normalizeAdminOnboardingFilters(filters);
    if (!normalized.ok) {
      setWorkflowVersionInvalid(true);
      return;
    }

    setWorkflowVersionInvalid(false);
    applyFilters(toAppliedFilters(normalized.filters));
  };

  const handleReset = (): void => {
    setFilters(createDefaultFilters());
    setWorkflowVersionInvalid(false);
    resetFilters();
  };

  const updateFilter = <K extends keyof AdminOnboardingFilters>(
    key: K,
    value: AdminOnboardingFilters[K],
  ): void => {
    setWorkflowVersionInvalid(false);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleReload = (): void => {
    reload();
  };

  const disabled = phase === 'loading';
  const invalidInputError = error?.reason === 'invalid-input';
  const showInlineWorkflowVersionError = workflowVersionInvalid || invalidInputError;
  const showTable = phase === 'ready';
  const appliedFilterActive = hasAppliedFilters(appliedFilters);

  let statusMessage: string;
  let visibleRecords: AdminOnboardingSummary[] = [];
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading onboardings\u2026';
  } else if (phase === 'error') {
    statusMessage = error ? describeFetchError(error) : 'Unable to load onboardings.';
  } else if (showInlineWorkflowVersionError) {
    statusMessage = WORKFLOW_VERSION_ERROR_MESSAGE;
    if (records.length === 0) {
      emptyMessage = 'Enter a valid workflow version to see results.';
    } else {
      visibleRecords = records;
    }
  } else if (records.length === 0) {
    if (appliedFilterActive) {
      statusMessage = 'No onboardings match the current filters.';
      emptyMessage = 'No onboardings match the current filters.';
    } else {
      statusMessage = 'No onboardings were returned.';
      emptyMessage = 'No onboardings were returned.';
    }
  } else {
    statusMessage = `Showing ${records.length} onboardings.`;
    visibleRecords = records;
  }

  return (
    <div className="page">
      <h1>Admin onboardings</h1>
      <OnboardingFilters
        filters={filters}
        disabled={disabled}
        workflowVersionInvalid={showInlineWorkflowVersionError}
        onFilterChange={updateFilter}
        onSubmit={handleSubmit}
        onReset={handleReset}
        onReload={handleReload}
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
