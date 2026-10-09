import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import type { ApiError } from '@/services/api/api-error';
import type { AdminPageProps } from '@/lib/admin-page';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import {
  countActiveAdminOnboardingFilters,
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  type AdminOnboardingDraftFilters,
  type AdminOnboardingFilters,
  isRequestableWorkflowVersion,
  WORKFLOW_VERSION_ERROR_MESSAGE,
} from './utils/filter-admin-onboardings';
import { useAdminOnboardings } from './hooks/useAdminOnboardings';
import { OnboardingFilters } from './components/OnboardingFilters';
import { OnboardingResults } from './components/OnboardingResults/OnboardingResults';
import { OnboardingStatusTabs } from './components/OnboardingStatusTabs/OnboardingStatusTabs';

function describeFetchError(error: ApiError): string {
  return `Unable to load onboardings: ${error.message}`;
}

/** Everything the operator drafts in the controls, which is the committed set minus `status`. */
function toDraftFilters(filters: AdminOnboardingFilters): AdminOnboardingDraftFilters {
  const { workflowId, workflowVersion, currentStep, onboardingId, limit } = filters;
  return { workflowId, workflowVersion, currentStep, onboardingId, limit };
}

/** Composes the onboardings section: its header, status tabs, filter band, and results table. */
export function OnboardingsPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const {
    phase,
    records,
    pagination,
    error,
    appliedFilters,
    appliedSearchValues,
    applyFilters,
    goToPage,
    refetch,
    resetFilters,
  } = useAdminOnboardings();
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on, which is why `status` is left out of it: the tab strip commits status by
  // navigating, without remounting this page, so a drafted copy would go stale the moment a tab
  // is clicked and would undo it on the next Apply.
  const [filters, setFilters] = useState<AdminOnboardingDraftFilters>(() =>
    toDraftFilters(appliedFilters),
  );
  const [workflowVersionInvalid, setWorkflowVersionInvalid] = useState(false);

  // Status comes from the committed set rather than the draft, so applying a panel criterion
  // carries the tab the operator is on instead of replacing it.
  const commitFilters = (nextFilters: AdminOnboardingDraftFilters): void => {
    if (!isRequestableWorkflowVersion(nextFilters.workflowVersion)) {
      setWorkflowVersionInvalid(true);
      return;
    }

    setWorkflowVersionInvalid(false);
    applyFilters({ ...nextFilters, status: appliedFilters.status });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    commitFilters(filters);
  };

  const handleReset = (): void => {
    setFilters(toDraftFilters(DEFAULT_ADMIN_ONBOARDING_FILTERS));
    setWorkflowVersionInvalid(false);
    resetFilters();
  };

  const updateFilter = <K extends keyof AdminOnboardingDraftFilters>(
    key: K,
    value: AdminOnboardingDraftFilters[K],
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
  const appliedCount = countActiveAdminOnboardingFilters(appliedSearchValues);
  const appliedFilterActive = appliedCount > 0;

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
      <PageHeader eyebrow={eyebrow} title={title} />
      <OnboardingStatusTabs filters={appliedFilters} total={pagination?.total ?? 0} />
      <OnboardingFilters
        filters={filters}
        appliedCount={appliedCount}
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
