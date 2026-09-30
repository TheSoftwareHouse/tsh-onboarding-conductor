import type { ReactElement } from 'react';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { Table, TableEmptyRow, Th } from '@/components/ui/DataTable/DataTable';
import { WorkflowTableRow } from './WorkflowTableRow/WorkflowTableRow';

const TABLE_COLUMN_COUNT = 7;

export interface WorkflowTableProps {
  showTable: boolean;
  records: AdminWorkflowSummary[];
  emptyMessage: string;
}

/** Renders the semantic results table: caption, column headers, empty-state row, or data rows. */
export function WorkflowTable({
  showTable,
  records,
  emptyMessage,
}: WorkflowTableProps): ReactElement {
  return (
    <Table caption="Workflows matching the current filters">
      <thead>
        <tr>
          <Th className="w-2/5">Workflow</Th>
          <Th>Scope</Th>
          <Th>Serving</Th>
          <Th>Versions</Th>
          <Th align="end">In progress</Th>
          <Th>Added</Th>
          <Th align="end" />
        </tr>
      </thead>
      <tbody>
        {showTable && records.length === 0 && (
          <TableEmptyRow colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</TableEmptyRow>
        )}
        {showTable &&
          records.map((record) => <WorkflowTableRow key={record.workflowId} record={record} />)}
      </tbody>
    </Table>
  );
}
