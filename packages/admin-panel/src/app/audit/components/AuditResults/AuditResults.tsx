import type { ReactElement, ReactNode } from 'react';
import type { AuditEvent } from '@/api/audit/audit-events';
import { TableResults } from '@/components/ui/TableResults/TableResults';
import type { PaginationWindow } from '@/lib/pagination';
import { AuditTable } from './AuditTable/AuditTable';

export interface AuditResultsProps {
  /** Null hides the footer. */
  statusMessage: string | null;
  /** Replaces the rows and the footer. */
  state?: ReactNode;
  visibleEvents: AuditEvent[];
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
}

/** Thin wrapper binding the shared results band to the audit events table. */
export function AuditResults({
  statusMessage,
  state,
  visibleEvents,
  pagination,
  paginationDisabled,
  onPageChange,
}: AuditResultsProps): ReactElement {
  return (
    <TableResults
      statusMessage={statusMessage}
      regionLabel="Audit events results"
      paginationLabel="Audit pages"
      state={state}
      pagination={pagination}
      paginationDisabled={paginationDisabled}
      onPageChange={onPageChange}
    >
      <AuditTable events={visibleEvents} />
    </TableResults>
  );
}
