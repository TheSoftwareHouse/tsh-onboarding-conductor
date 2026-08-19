import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import {
  type AdminOnboardingFilters,
  type AdminOnboardingQueryFilters,
  type AdminOnboardingsFetchError,
  type AdminOnboardingSummary,
  createDefaultAdminOnboardingFilters,
  normalizeAdminOnboardingFilters,
  useAdminOnboardings,
  WORKFLOW_VERSION_ERROR_MESSAGE,
  OnboardingFilters,
  OnboardingResults,
} from '@/features/onboarding';
import { hasActiveFilters } from '@/shared/lib/count-active-filters';

function describeFetchError(error: AdminOnboardingsFetchError): string {
  return `Unable to load onboardings: ${error.message}`;
}

function toAppliedFilters(
  queryFilters: AdminOnboardingQueryFilters,
  limit: AdminOnboardingFilters['limit'],
): AdminOnboardingFilters {
  return {
    status: queryFilters.status ?? '',
    workflowId: queryFilters.workflowId ?? '',
    workflowVersion: queryFilters.workflowVersion ?? '',
    currentStep: queryFilters.currentStep ?? '',
    onboardingId: queryFilters.onboardingId ?? '',
    limit,
  };
}

/** Composes the onboardings section: filters, live status region, results table, and pager. */
export function AdminOnboardingsPage(): ReactElement {
  const {
    phase,
    records,
    pagination,
    error,
    appliedFilters,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  } = useAdminOnboardings();
  const [filters, setFilters] = useState<AdminOnboardingFilters>(
    createDefaultAdminOnboardingFilters,
  );
  const [workflowVersionInvalid, setWorkflowVersionInvalid] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const normalized = normalizeAdminOnboardingFilters(filters);
    if (!normalized.ok) {
      setWorkflowVersionInvalid(true);
      return;
    }

    setWorkflowVersionInvalid(false);
    applyFilters(toAppliedFilters(normalized.filters, filters.limit));
  };

  const handleReset = (): void => {
    setFilters(createDefaultAdminOnboardingFilters());
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
    refetch();
  };

  const disabled = phase === 'loading';
  const showInlineWorkflowVersionError = workflowVersionInvalid;
  const showTable = phase === 'ready';
  const appliedFilterActive = hasActiveFilters(appliedFilters, ['limit']);

  let statusMessage: string;
  let visibleRecords: AdminOnboardingSummary[] = [];
  let emptyMessage = '';

  if (phase === 'loading') {
    statusMessage = 'Loading onboardings…';
  } else if (phase === 'error') {
    statusMessage = error ? describeFetchError(error) : 'Unable to load onboardings.';
  } else if (showInlineWorkflowVersionError) {
    statusMessage = WORKFLOW_VERSION_ERROR_MESSAGE;
    if (records.length === 0) {
      emptyMessage = 'Enter a valid workflow version to see results.';
    } else {
      visibleRecords = records;
    }
  } else if (records.length === 0 || pagination === null) {
    if (appliedFilterActive) {
      statusMessage = 'No onboardings match the current filters.';
      emptyMessage = 'No onboardings match the current filters.';
    } else {
      statusMessage = 'No onboardings were returned.';
      emptyMessage = 'No onboardings were returned.';
    }
  } else {
    statusMessage = `Showing ${records.length} of ${pagination.total} onboardings (page ${pagination.page} of ${pagination.totalPages}).`;
    visibleRecords = records;
  }

  return (
    <>
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
        pagination={pagination}
        paginationDisabled={disabled}
        onPageChange={goToPage}
      />
    </>
  );
}
