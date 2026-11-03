import type { FormEvent, ReactElement, ReactNode } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { Button } from '@/components/ui/Button/Button';
import { EmptyState } from '@/components/ui/EmptyState/EmptyState';
import { Loader } from '@/components/ui/Loader/Loader';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import { LoadFailure } from '@/components/ui/LoadFailure/LoadFailure';
import {
  countActiveAdminWorkflowFilters,
  DEFAULT_ADMIN_WORKFLOW_FILTERS,
  type AdminWorkflowFilters,
} from './utils/filter-admin-workflows';
import { useWorkflowsFilters } from './hooks/useWorkflowsFilters';
import { WorkflowFilters } from './components/WorkflowFilters';
import { NewDraftDialog } from './components/NewDraftDialog/NewDraftDialog';
import { WorkflowResults } from './components/WorkflowResults/WorkflowResults';

/** Composes the workflows section: its header, filter band, and results table. */
export function WorkflowsPage({ eyebrow, title }: AdminPageProps): ReactElement {
  const { filters, appliedFilters, appliedSearchValues, applyFilters, goToPage, resetFilters } =
    useWorkflowsFilters();
  // Seeded from the committed filters so a returned-to or shared URL shows them, not blank ones.
  const [draft, setDraft] = useState<AdminWorkflowFilters>(() => appliedFilters);

  const { data, isPending, isError, error, refetch } = useQuery(workflowQueries.list(filters));

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    applyFilters(draft);
  };

  const handleReset = (): void => {
    setDraft(DEFAULT_ADMIN_WORKFLOW_FILTERS);
    resetFilters();
  };

  const updateFilter = <K extends keyof AdminWorkflowFilters>(
    key: K,
    value: AdminWorkflowFilters[K],
  ): void => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleReload = (): void => {
    refetch();
  };

  const disabled = isPending;
  const appliedCount = countActiveAdminWorkflowFilters(appliedSearchValues);

  // `data`/`error` stay optional after destructuring, so every read below falls back explicitly.
  const records = data?.records ?? [];
  const pagination = isPending || isError ? null : (data?.pagination ?? null);

  const resetAction = (
    <Button variant="primary" size="lg" onClick={handleReset}>
      Reset filters
    </Button>
  );

  let state: ReactNode;
  let statusMessage: string | null = null;
  let visibleRecords: AdminWorkflowSummary[] = [];

  if (isPending) {
    state = <Loader label="Loading workflows…" />;
  } else if (isError) {
    state = <LoadFailure error={error} subject="workflows" onRetry={handleReload} />;
  } else if (records.length === 0 || pagination === null) {
    if (pagination !== null && pagination.total > 0) {
      state = <EmptyState kind="noMatch" title="No workflows on this page" />;
    } else if (filters.search !== null) {
      state = (
        <EmptyState
          kind="noMatch"
          title={`No workflows match "${filters.search}"`}
          body="Check the spelling, or reset the filters."
          actions={resetAction}
        />
      );
    } else if (appliedCount > 0) {
      state = (
        <EmptyState
          kind="noMatch"
          title="No workflows match these filters"
          body="Change or reset the filters to see more."
          actions={resetAction}
        />
      );
    } else {
      state = (
        <EmptyState
          title="No workflows yet"
          body="Start one from a blank draft."
          actions={<NewDraftDialog />}
        />
      );
    }
  } else {
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);
    statusMessage = `Showing ${from}–${to} of ${pagination.total} workflows.`;
    visibleRecords = records;
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader eyebrow={eyebrow} title={title}>
        <NewDraftDialog />
      </PageHeader>
      <WorkflowFilters
        filters={draft}
        appliedCount={appliedCount}
        disabled={disabled}
        onFilterChange={updateFilter}
        onSubmit={handleSubmit}
        onReset={handleReset}
        onReload={handleReload}
      />
      <WorkflowResults
        statusMessage={statusMessage}
        state={state}
        visibleRecords={visibleRecords}
        pagination={pagination}
        paginationDisabled={disabled}
        onPageChange={goToPage}
      />
    </div>
  );
}
