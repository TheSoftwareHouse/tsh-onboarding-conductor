import type { ReactElement } from 'react';
import type { AuditEvent } from '@/api/audit/audit-events';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import type { PaginationWindow } from '@/lib/pagination';
import { AuditTable } from './AuditTable/AuditTable';

export interface AuditResultsProps {
  statusMessage: string;
  showTable: boolean;
  visibleEvents: AuditEvent[];
  emptyMessage: string;
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the audit events table. */
export function AuditResults({
  statusMessage,
  showTable,
  visibleEvents,
  emptyMessage,
  pagination,
  paginationDisabled,
  onPageChange,
}: AuditResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Audit events results"
      paginationLabel="Audit pages"
      showTable={showTable}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <AuditTable showTable={showTable} events={visibleEvents} emptyMessage={emptyMessage} />
    </TableResults>
  );
}
