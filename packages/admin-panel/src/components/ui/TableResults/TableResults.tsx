import type { ReactElement, ReactNode } from 'react';
import { TableSurface } from '../DataTable/DataTable';
import { Pagination } from '../Pagination/Pagination';
import { StatusRegion } from '../StatusRegion/StatusRegion';
import type { PaginationWindow } from '@/lib/pagination';

export interface TableResultsProps {
  /** Null hides the footer. */
  statusMessage: string | null;
  regionLabel: string;
  paginationLabel: string;
  /** Loading, failure, empty or no-match message, shown under the column headers in place of rows and footer. */
  state?: ReactNode;
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
  children: ReactNode;
}

/**
 * The band shared by every list section: the scrollable table, then a footer holding the
 * live status message and the pager. A `state` replaces the rows and the footer.
 */
export function TableResults({
  statusMessage,
  regionLabel,
  paginationLabel,
  state,
  pagination,
  paginationDisabled,
  onPageChange,
  children,
}: TableResultsProps): ReactElement {
  const hasState = Boolean(state);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TableSurface label={regionLabel} className="flex flex-col">
        {children}
        {hasState && state}
      </TableSurface>
      {!hasState && statusMessage !== null && (
        <div className="flex flex-none items-center justify-between gap-4 border-t border-border-rule px-8 py-4">
          <StatusRegion>{statusMessage}</StatusRegion>
          {pagination !== null && pagination.totalPages > 0 && (
            <Pagination
              pagination={pagination}
              label={paginationLabel}
              disabled={paginationDisabled}
              onPageChange={onPageChange}
            />
          )}
        </div>
      )}
    </div>
  );
}
