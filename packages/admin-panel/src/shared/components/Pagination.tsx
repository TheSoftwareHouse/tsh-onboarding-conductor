import type { ReactElement } from 'react';
import type { PaginationWindow } from '../lib/pagination';

export interface PaginationProps {
  pagination: PaginationWindow;
  /** Accessible name for the pager, naming the list it steps through. */
  label: string;
  disabled: boolean;
  onPageChange: (page: number) => void;
}

/**
 * Steps through the pages an endpoint reported. Every paginated admin view renders this one
 * control, so the pager reads and behaves the same wherever it appears.
 *
 * The endpoints paginate server-side, so moving page issues a new request rather than slicing
 * rows the panel already holds.
 */
export function Pagination({
  pagination,
  label,
  disabled,
  onPageChange,
}: PaginationProps): ReactElement {
  const { page, totalPages } = pagination;

  return (
    <nav className="pagination" aria-label={label}>
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
