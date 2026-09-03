import type { ReactElement } from 'react';
import { Pagination } from '@/shared/components/Pagination';
import type { PaginationWindow } from '@/shared/lib/pagination';
import type { AdminOnboardingSummary } from '../types/admin-onboarding';
import type {
  AdminOnboardingSortDirection,
  AdminOnboardingSortField,
} from '../utils/filter-admin-onboardings';
import { OnboardingTable } from './OnboardingTable';

export interface OnboardingResultsProps {
  statusMessage: string;
  showTable: boolean;
  visibleRecords: AdminOnboardingSummary[];
  emptyMessage: string;
  /** Null while no page window is available, which also hides the pager. */
  pagination: PaginationWindow | null;
  paginationDisabled: boolean;
  onPageChange: (page: number) => void;
  sortBy: AdminOnboardingSortField;
  sortDir: AdminOnboardingSortDirection;
  onSort: (field: AdminOnboardingSortField) => void;
}

/**
 * Renders the polite live-region status message, the bounded, scrollable results table, and the
 * page controls.
 */
export function OnboardingResults({
  statusMessage,
  showTable,
  visibleRecords,
  emptyMessage,
  pagination,
  paginationDisabled,
  onPageChange,
  sortBy,
  sortDir,
  onSort,
}: OnboardingResultsProps): ReactElement {
  return (
    <>
      <p className="status-region" role="status" aria-live="polite">
        {statusMessage}
      </p>
      <div
        className="table-wrapper"
        tabIndex={0}
        role="region"
        aria-label="Onboardings results"
        hidden={!showTable}
      >
        <OnboardingTable
          showTable={showTable}
          records={visibleRecords}
          emptyMessage={emptyMessage}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={onSort}
        />
      </div>
      {pagination !== null && pagination.totalPages > 0 && (
        <Pagination
          pagination={pagination}
          label="Onboarding pages"
          disabled={paginationDisabled}
          onPageChange={onPageChange}
        />
      )}
    </>
  );
}
