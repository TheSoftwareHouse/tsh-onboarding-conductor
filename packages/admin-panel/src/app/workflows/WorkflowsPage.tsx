import type { FormEvent, ReactElement } from 'react';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type {
  AdminWorkflowsFetchError,
  AdminWorkflowSummary,
} from '@/api/workflows/admin-workflows';
import { workflowQueries } from '@/api/workflows/workflow-queries';
import type { AdminPageProps } from '@/lib/admin-page';
import { PageHeader } from '@/components/ui/PageHeader/PageHeader';
import {
  countActiveAdminWorkflowFilters,
  DEFAULT_ADMIN_WORKFLOW_FILTERS,
  type AdminWorkflowFilters,
} from './utils/filter-admin-workflows';
import { useWorkflowsFilters } from './hooks/useWorkflowsFilters';
import { WorkflowFilters } from './components/WorkflowFilters';
import { NewDraftDialog } from './components/NewDraftDialog/NewDraftDialog';
import { WorkflowResults } from './components/WorkflowResults/WorkflowResults';

function describeFetchError(error: AdminWorkflowsFetchError): string {
  return `Unable to load workflows: ${error.message}`;
}

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
  const showTable = !isPending && !isError;
  const appliedCount = countActiveAdminWorkflowFilters(appliedSearchValues);

  // `data`/`error` stay optional after destructuring, so every read below falls back explicitly.
  const records = data?.records ?? [];
  const pagination = isPending || isError ? null : (data?.pagination ?? null);

  let statusMessage: string;
  let visibleRecords: AdminWorkflowSummary[] = [];
  let emptyMessage = '';

  if (isPending) {
    statusMessage = 'Loading workflows…';
  } else if (isError) {
    statusMessage = error ? describeFetchError(error) : 'Unable to load workflows.';
  } else if (records.length === 0) {
    if (pagination !== null && pagination.total > 0) {
      statusMessage = 'No workflows on this page.';
    } else if (filters.search !== null) {
      statusMessage = `No workflows match "${filters.search}".`;
    } else if (appliedCount > 0) {
      statusMessage = 'No workflows match these filters.';
    } else {
      statusMessage = 'No workflows loaded.';
    }
    emptyMessage = statusMessage;
  } else if (pagination !== null) {
    const from = (pagination.page - 1) * pagination.limit + 1;
    const to = Math.min(pagination.page * pagination.limit, pagination.total);
    statusMessage = `Showing ${from}–${to} of ${pagination.total} workflows.`;
    visibleRecords = records;
  } else {
    statusMessage = 'No workflows loaded.';
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
