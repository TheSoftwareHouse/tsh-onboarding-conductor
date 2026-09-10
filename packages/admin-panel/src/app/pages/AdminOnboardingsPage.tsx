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
  OnboardingSearch,
  OnboardingStatusTabs,
} from '@/features/onboarding';
import { PageHeaderActions } from '@/shared/components/PageHeader/PageHeaderActions';
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

/** Composes the onboardings section: header search, status tabs, filter band, and results table. */
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
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on.
  const [filters, setFilters] = useState<AdminOnboardingFilters>(appliedFilters);
  const [workflowVersionInvalid, setWorkflowVersionInvalid] = useState(false);

  const commitFilters = (nextFilters: AdminOnboardingFilters): void => {
    const normalized = normalizeAdminOnboardingFilters(nextFilters);
    if (!normalized.ok) {
      setWorkflowVersionInvalid(true);
      return;
    }

    setWorkflowVersionInvalid(false);
    applyFilters(toAppliedFilters(normalized.filters, nextFilters.limit));
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    commitFilters(filters);
  };

  const handleSearchSubmit = (onboardingId: string): void => {
    const nextFilters = { ...filters, onboardingId };
    setFilters(nextFilters);
    commitFilters(nextFilters);
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
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeaderActions>
        {/* Keyed on the committed value so Reset filters (or a fresh submit) remounts the search
            box with the new seed instead of leaving a stale draft behind. */}
        <OnboardingSearch
          key={appliedFilters.onboardingId}
          value={appliedFilters.onboardingId}
          disabled={disabled}
          onSubmit={handleSearchSubmit}
        />
      </PageHeaderActions>
      <OnboardingStatusTabs filters={appliedFilters} total={pagination?.total ?? 0} />
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
    </div>
  );
}
