import type { ReactElement } from 'react';
import { Table, TableEmptyRow, Th } from '@/shared/components/DataTable/DataTable';
import type { AuditEvent } from '../types/audit-event';
import { AuditTableRow } from './AuditTableRow';

const TABLE_COLUMN_COUNT = 7;

export interface AuditTableProps {
  showTable: boolean;
  events: AuditEvent[];
  emptyMessage: string;
}

/** Renders the semantic results table: caption, column headers, empty-state row, or data rows. */
export function AuditTable({ showTable, events, emptyMessage }: AuditTableProps): ReactElement {
  return (
    <Table caption="Audit events matching the current filters">
      <thead>
        <tr>
          <Th>Occurred at</Th>
          <Th>Actor type</Th>
          <Th>Actor ID</Th>
          <Th>Action</Th>
          <Th>Resource type</Th>
          <Th>Resource ID</Th>
          <Th>Metadata</Th>
        </tr>
      </thead>
      <tbody>
        {showTable && events.length === 0 && (
          <TableEmptyRow colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</TableEmptyRow>
        )}
        {showTable && events.map((event) => <AuditTableRow key={event.id} event={event} />)}
      </tbody>
    </Table>
  );
}
