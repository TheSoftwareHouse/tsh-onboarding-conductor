import type { ReactElement } from 'react';
import type { AuditPagination as AuditPaginationValue } from '../types/audit-event';

export interface AuditPaginationProps {
  pagination: AuditPaginationValue;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Steps through the pages the endpoint reported. The endpoint paginates server-side, so moving
 * page issues a new request rather than slicing rows the panel already holds.
 */
export function AuditPagination({
  pagination,
  disabled,
  onPageChange,
}: AuditPaginationProps): ReactElement {
  const { page, totalPages } = pagination;

  return (
    <nav className="pagination" aria-label="Audit pages">
      <button type="button" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)}>
        Previous
      </button>
      <span className="pagination__position">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={disabled || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
      >
        Next
      </button>
    </nav>
  );
}
