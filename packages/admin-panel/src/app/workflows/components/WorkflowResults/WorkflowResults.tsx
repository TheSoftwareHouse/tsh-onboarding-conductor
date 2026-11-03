import type { ReactElement, ReactNode } from 'react';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import type { PaginationWindow } from '@/lib/pagination';
import { WorkflowTable } from './WorkflowTable/WorkflowTable';

export interface WorkflowResultsProps {
  /** Null hides the footer. */
  statusMessage: string | null;
  /** Replaces the rows and the footer. */
  state?: ReactNode;
  visibleRecords: AdminWorkflowSummary[];
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the workflows table. */
export function WorkflowResults({
  statusMessage,
  state,
  visibleRecords,
  pagination,
  paginationDisabled,
  onPageChange,
}: WorkflowResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Workflows results"
      paginationLabel="Workflow pages"
      state={state}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <WorkflowTable records={visibleRecords} />
    </TableResults>
  );
}
