import type { ReactElement } from 'react';
import { TableResults } from '@/shared/components/TableResults/TableResults';
import type { PaginationWindow } from '@/shared/lib/pagination';
import type { AuditEvent } from '../types/audit-event';
import { AuditTable } from './AuditTable';

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
