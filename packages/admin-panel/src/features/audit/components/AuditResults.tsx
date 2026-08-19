import type { ReactElement } from 'react';
import { Pagination } from '@/shared/components/Pagination';
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

/** Renders the polite live-region status message, the results table, and the page controls. */
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
    <>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div
        className="table-wrapper"
        tabIndex={0}
        role="region"
        aria-label="Audit events results"
        hidden={!showTable}
      >
        <AuditTable showTable={showTable} events={visibleEvents} emptyMessage={emptyMessage} />
      </div>
      {pagination !== null && pagination.totalPages > 0 && (
        <Pagination
          pagination={pagination}
          label="Audit pages"
          disabled={paginationDisabled}
          onPageChange={onPageChange}
        />
      )}
    </>
  );
}
