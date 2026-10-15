import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import type { AdminOnboardingSummary } from '@/api/onboardings/admin-onboardings';
import type { ApiError } from '@/services/api/api-error';
import type { AdminPageProps } from '@/lib/admin-page';
import { Button } from '@/components/ui/Button/Button';
import { Download } from '@/components/ui/icons';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import {
  countActiveAdminOnboardingFilters,
  DEFAULT_ADMIN_ONBOARDING_FILTERS,
  findDraftError,
  type AdminOnboardingDraftError,
  type AdminOnboardingDraftFilters,
  type AdminOnboardingFilters,
} from './utils/filter-admin-onboardings';
import { toExportFilters } from './utils/admin-onboardings-search-params';
import { useAdminOnboardings } from './hooks/useAdminOnboardings';
import { useOnboardingsExport } from './hooks/useOnboardingsExport';
import { OnboardingFilters } from './components/OnboardingFilters';
import { OnboardingResults } from './components/OnboardingResults/OnboardingResults';
import { OnboardingStatusTabs } from './components/OnboardingStatusTabs/OnboardingStatusTabs';

function describeFetchError(error: ApiError): string {
  return `Unable to load onboardings: ${error.message}`;
}

/** Everything the operator drafts in the controls, which is the committed set minus `status`. */
function toDraftFilters(filters: AdminOnboardingFilters): AdminOnboardingDraftFilters {
  const {
    workflowId,
    workflowVersion,
    currentStep,
    onboardingId,
    parked,
    pendingConnectorId,
    parkedBefore,
    limit,
  } = filters;
  return {
    workflowId,
    workflowVersion,
    currentStep,
    onboardingId,
    parked,
    pendingConnectorId,
    parkedBefore,
    limit,
  };
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
  const { exportCsv, pending: exporting } = useOnboardingsExport();
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on, which is why `status` is left out of it: the tab strip commits status by
  // navigating, without remounting this page, so a drafted copy would go stale the moment a tab
  // is clicked and would undo it on the next Apply.
  const [filters, setFilters] = useState<AdminOnboardingDraftFilters>(() =>
    toDraftFilters(appliedFilters),
  );
  const [draftError, setDraftError] = useState<AdminOnboardingDraftError | null>(null);

  // Status comes from the committed set rather than the draft, so applying a panel criterion
  // carries the tab the operator is on instead of replacing it.
  const commitFilters = (nextFilters: AdminOnboardingDraftFilters): void => {
    const error = findDraftError(nextFilters);
    setDraftError(error);
    if (error !== null) {
      return;
    }

    applyFilters({ ...nextFilters, status: appliedFilters.status });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    commitFilters(filters);
  };

  const handleReset = (): void => {
    setFilters(toDraftFilters(DEFAULT_ADMIN_ONBOARDING_FILTERS));
    setDraftError(null);
    resetFilters();
  };

  const updateFilter = <K extends keyof AdminOnboardingDraftFilters>(
    key: K,
    value: AdminOnboardingDraftFilters[K],
  ): void => {
    setDraftError(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleReload = (): void => {
    refetch();
  };

  // The committed criteria, never the draft: the export covers what the list on screen shows.
  const handleExport = (): void => {
    exportCsv(toExportFilters(appliedSearchValues));
  };

  // The list's total for the same criteria, which is exactly the export's row count; null while loading or after a failed load.
  const exportCount = pagination?.total ?? null;

  const disabled = phase === 'loading';
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
  } else if (draftError !== null) {
    statusMessage = draftError.message;
    if (records.length === 0) {
      emptyMessage = 'Correct the refused filter to see results.';
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
      <PageHeader eyebrow={eyebrow} title={title}>
        {/* Hidden rather than disabled while there is no count to name: loading or a failed load. */}
        {exportCount === null ? undefined : (
          <Button
            variant="outline"
            size="lg"
            className="gap-2"
            disabled={exporting || draftError !== null || exportCount === 0}
            onClick={handleExport}
          >
            <Download aria-hidden="true" focusable="false" className="size-4.5" />
            {exporting ? 'Exporting…' : `Export ${exportCount} as CSV`}
          </Button>
        )}
      </PageHeader>
      <OnboardingStatusTabs filters={appliedFilters} total={pagination?.total ?? 0} />
      <OnboardingFilters
        filters={filters}
        appliedCount={appliedCount}
        disabled={disabled}
        error={draftError}
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
