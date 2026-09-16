import type { ReactElement } from 'react';
import { Table, TableEmptyRow, Th } from '@/components/ui/DataTable/DataTable';
import type { AuditEvent } from '../../../types/audit-event';
import { AuditTableRow } from './AuditTableRow/AuditTableRow';

const TABLE_COLUMN_COUNT = 6;

export interface AuditTableProps {
  showTable: boolean;
  events: AuditEvent[];
  emptyMessage: string;
}

/**
 * Renders the semantic results table: caption, column headers, empty-state row, or data rows.
 *
 * The layout is fixed rather than auto because metadata is the one column whose content changes
 * shape per action — a webhook payload is orders of magnitude wider than `method: GET` — and under
 * auto layout that redistributes every other column, so the same table looks different on each
 * page. `colgroup` sizes the five predictable columns once and metadata takes what is left; the
 * `min-w` keeps those widths intact on a narrow viewport, where `TableSurface` scrolls instead.
 */
export function AuditTable({ showTable, events, emptyMessage }: AuditTableProps): ReactElement {
  return (
    <Table caption="Audit events matching the current filters" className="min-w-344 table-fixed">
      <colgroup>
        <col className="w-52" />
        <col className="w-36" />
        <col className="w-72" />
        <col className="w-40" />
        <col className="w-56" />
        <col />
      </colgroup>
      <thead>
        <tr>
          <Th>Occurred</Th>
          <Th>Actor</Th>
          <Th>Action</Th>
          <Th>Resource type</Th>
          <Th>Resource</Th>
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
