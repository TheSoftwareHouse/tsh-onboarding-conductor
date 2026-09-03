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
  SCORE_ERROR_MESSAGE,
  WORKFLOW_VERSION_ERROR_MESSAGE,
  OnboardingFilters,
  OnboardingResults,
} from '@/features/onboarding';
import { hasActiveFilters } from '@/shared/lib/count-active-filters';
import {
  DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
  DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
  type AdminOnboardingSortField,
} from '@/features/onboarding';

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
    minScore: queryFilters.minScore ?? '',
    maxScore: queryFilters.maxScore ?? '',
    sortBy: queryFilters.sortBy ?? DEFAULT_ADMIN_ONBOARDING_SORT_FIELD,
    sortDir: queryFilters.sortDir ?? DEFAULT_ADMIN_ONBOARDING_SORT_DIRECTION,
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
  // Seeded from the committed filters so a URL carrying criteria - a shared link, or the section
  // returned to - shows them in the controls instead of blank ones. The draft is the operator's
  // from then on.
  const [filters, setFilters] = useState<AdminOnboardingFilters>(appliedFilters);
  // Which criterion the normalizer refused, so the panel can name it. Null while nothing is.
  const [invalidCriterion, setInvalidCriterion] = useState<'workflow-version' | 'score' | null>(
    null,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();

    const normalized = normalizeAdminOnboardingFilters(filters);
    if (!normalized.ok) {
      setInvalidCriterion(
        normalized.error.reason === 'invalid-workflow-version' ? 'workflow-version' : 'score',
      );
      return;
    }

    setInvalidCriterion(null);
    applyFilters(toAppliedFilters(normalized.filters, filters.limit));
  };

  const handleReset = (): void => {
    setFilters(createDefaultAdminOnboardingFilters());
    setInvalidCriterion(null);
    resetFilters();
  };

  const updateFilter = <K extends keyof AdminOnboardingFilters>(
    key: K,
    value: AdminOnboardingFilters[K],
  ): void => {
    setInvalidCriterion(null);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleReload = (): void => {
    refetch();
  };

  /**
   * Sorting is committed straight away rather than waiting for the form to be submitted: a column
   * header reads as an action, not as another criterion to fill in. Using the column already
   * sorted on reverses it; using any other starts it descending, which is the more useful first
   * look at each of these columns — newest, most recently completed, highest scoring.
   */
  const handleSort = (field: AdminOnboardingSortField): void => {
    const nextFilters: AdminOnboardingFilters = {
      ...filters,
      sortBy: field,
      sortDir:
        appliedFilters.sortBy === field && appliedFilters.sortDir === 'desc' ? 'asc' : 'desc',
    };

    setFilters(nextFilters);
    setInvalidCriterion(null);

    const normalized = normalizeAdminOnboardingFilters(nextFilters);
    if (normalized.ok) {
      applyFilters(toAppliedFilters(normalized.filters, nextFilters.limit));
    }
  };

  const disabled = phase === 'loading';
  const showInlineWorkflowVersionError = invalidCriterion === 'workflow-version';
  const showInlineScoreError = invalidCriterion === 'score';
  const showTable = phase === 'ready';
  // `sortBy` and `sortDir` always carry a value, so they are an ordering rather than a
  // criterion the results were narrowed by.
  const appliedFilterActive = hasActiveFilters(appliedFilters, ['limit', 'sortBy', 'sortDir']);

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
  } else if (showInlineScoreError) {
    statusMessage = SCORE_ERROR_MESSAGE;
    if (records.length === 0) {
      emptyMessage = 'Enter a valid score to see results.';
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
        scoreInvalid={showInlineScoreError}
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
        sortBy={appliedFilters.sortBy}
        sortDir={appliedFilters.sortDir}
        onSort={handleSort}
      />
    </>
  );
}
