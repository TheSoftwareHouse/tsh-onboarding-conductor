import type { ReactElement } from 'react';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import type { PaginationWindow } from '@/lib/pagination';
import { WorkflowTable } from './WorkflowTable/WorkflowTable';

export interface WorkflowResultsProps {
  statusMessage: string;
  showTable: boolean;
  visibleRecords: AdminWorkflowSummary[];
  emptyMessage: string;
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the workflows table. */
export function WorkflowResults({
  statusMessage,
  showTable,
  visibleRecords,
  emptyMessage,
  pagination,
  paginationDisabled,
  onPageChange,
}: WorkflowResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Workflows results"
      paginationLabel="Workflow pages"
      showTable={showTable}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <WorkflowTable showTable={showTable} records={visibleRecords} emptyMessage={emptyMessage} />
    </TableResults>
  );
}
