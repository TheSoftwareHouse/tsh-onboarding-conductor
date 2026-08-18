import type { ReactElement } from 'react';
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
    <table>
      <caption className="visually-hidden">Audit events matching the current filters</caption>
      <thead>
        <tr>
          <th scope="col">Occurred at</th>
          <th scope="col">Actor type</th>
          <th scope="col">Actor ID</th>
          <th scope="col">Action</th>
          <th scope="col">Resource type</th>
          <th scope="col">Resource ID</th>
          <th scope="col">Metadata</th>
        </tr>
      </thead>
      <tbody>
        {showTable && events.length === 0 && (
          <tr className="empty-row">
            <td colSpan={TABLE_COLUMN_COUNT}>{emptyMessage}</td>
          </tr>
        )}
        {showTable && events.map((event) => <AuditTableRow key={event.id} event={event} />)}
      </tbody>
    </table>
  );
}
