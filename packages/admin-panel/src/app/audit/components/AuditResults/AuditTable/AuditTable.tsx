import type { ReactElement } from 'react';
import type { AuditEvent } from '@/api/audit/audit-events';
import { Table, Th } from '@/components/ui/DataTable/DataTable';
import { AuditTableRow } from './AuditTableRow/AuditTableRow';

export interface AuditTableProps {
  events: AuditEvent[];
}

/**
 * Renders the semantic results table: caption, column headers and data rows.
 *
 * The layout is fixed rather than auto because metadata is the one column whose content changes
 * shape per action — a webhook payload is orders of magnitude wider than `method: GET` — and under
 * auto layout that redistributes every other column, so the same table looks different on each
 * page. `colgroup` sizes the five predictable columns once and metadata takes what is left; the
 * `min-w` keeps those widths intact on a narrow viewport, where `TableSurface` scrolls instead.
 */
export function AuditTable({ events }: AuditTableProps): ReactElement {
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
        {events.map((event) => (
          <AuditTableRow key={event.id} event={event} />
        ))}
      </tbody>
    </Table>
  );
}
