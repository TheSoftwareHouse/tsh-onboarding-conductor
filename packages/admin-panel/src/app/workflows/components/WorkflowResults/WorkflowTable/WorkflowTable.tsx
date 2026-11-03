import type { ReactElement } from 'react';
import type { AdminWorkflowSummary } from '@/api/workflows/admin-workflows';
import { Table, Th } from '@/components/ui/DataTable/DataTable';
import { WorkflowTableRow } from './WorkflowTableRow/WorkflowTableRow';

export interface WorkflowTableProps {
  records: AdminWorkflowSummary[];
}

/** Renders the semantic results table: caption, column headers and data rows. */
export function WorkflowTable({ records }: WorkflowTableProps): ReactElement {
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
        {records.map((record) => (
          <WorkflowTableRow key={record.workflowId} record={record} />
        ))}
      </tbody>
    </Table>
  );
}
